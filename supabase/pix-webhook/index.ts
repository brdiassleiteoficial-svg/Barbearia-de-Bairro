import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const token = Deno.env.get("MP_ACCESS_TOKEN");
    const secret = Deno.env.get("MP_WEBHOOK_SECRET");
    if (!token || !secret) return new Response("Webhook não configurado", { status: 503 });

    const body = await req.json();
    const paymentId = String(body?.data?.id ?? new URL(req.url).searchParams.get("data.id") ?? "");
    if (!paymentId) return new Response("Missing payment id", { status: 400 });

    // Validação de assinatura do webhook do Mercado Pago.
    const signature = req.headers.get("x-signature") ?? "";
    const requestId = req.headers.get("x-request-id") ?? "";
    const parts = Object.fromEntries(signature.split(",").map((part: string) => {
      const [key, value] = part.trim().split("=");
      return [key, value];
    }));
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1 || !requestId) return new Response("Invalid signature headers", { status: 401 });

    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const expected = await hmacSha256(secret, manifest);
    if (!safeEqual(expected, v1.toLowerCase())) return new Response("Invalid signature", { status: 401 });

    // Nunca confiar apenas no corpo do webhook: consultar o pagamento na API.
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payment = await mpResponse.json();
    if (!mpResponse.ok) return new Response("Could not verify payment", { status: 502 });

    const appointmentId = String(payment.external_reference ?? "");
    if (!appointmentId) return new Response("Missing external reference", { status: 400 });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: stored, error: findError } = await admin
      .from("payments")
      .select("id,amount,appointment_id,status")
      .eq("provider_payment_id", paymentId)
      .eq("appointment_id", appointmentId)
      .maybeSingle();

    if (findError || !stored) return new Response("Payment record not found", { status: 404 });

    // Valor e moeda devem corresponder ao registro criado no servidor.
    if (Number(payment.transaction_amount) !== Number(stored.amount) || payment.currency_id !== "BRL") {
      return new Response("Payment amount mismatch", { status: 409 });
    }

    const statusMap: Record<string, string> = {
      approved: "paid",
      rejected: "failed",
      cancelled: "failed",
      refunded: "refunded",
      charged_back: "refunded",
      pending: "pending",
      in_process: "pending",
    };
    const newStatus = statusMap[payment.status] ?? "pending";

    const { error: updatePaymentError } = await admin
      .from("payments")
      .update({ status: newStatus })
      .eq("id", stored.id);
    if (updatePaymentError) throw updatePaymentError;

    if (newStatus === "paid") {
      const { error: updateAppointmentError } = await admin
        .from("appointments")
        .update({ status: "confirmed" })
        .eq("id", appointmentId)
        .eq("status", "pending");
      if (updateAppointmentError) throw updateAppointmentError;
    } else if (["failed", "refunded"].includes(newStatus)) {
      // Não cancelar automaticamente uma reserva já confirmada por outra regra.
      await admin.from("appointments")
        .update({ status: "cancelled" })
        .eq("id", appointmentId)
        .eq("status", "pending");
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("pix-webhook:", error);
    return new Response("Webhook processing error", { status: 500 });
  }
});
