import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ success: false, message: "Método não permitido." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return response({ success: false, message: "Faça login para agendar." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return response({ success: false, message: "Sessão inválida. Entre novamente." }, 401);

    const body = await req.json();
    const { serviceId, barberId, date, time, name, phone, email } = body ?? {};

    if (!serviceId || !date || !time || !name || !phone || !email) {
      return response({ success: false, message: "Preencha todos os campos do agendamento." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return response({ success: false, message: "Data ou horário inválido." }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: booking, error: bookingError } = await admin.rpc("create_appointment_secure", {
      p_user_id: userData.user.id,
      p_service_id: serviceId,
      p_barber_id: barberId || null,
      p_date: date,
      p_time: time,
      p_name: String(name).trim().slice(0, 120),
      p_phone: String(phone).trim().slice(0, 20),
      p_email: String(email).trim().slice(0, 254),
      p_timezone: "America/Fortaleza",
    });

    if (bookingError) throw new Error(bookingError.message);

    // Pix real opcional via Mercado Pago.
    // Configure MP_ACCESS_TOKEN e MP_NOTIFICATION_URL nos secrets da Edge Function.
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    const notificationUrl = Deno.env.get("MP_NOTIFICATION_URL");

    if (mpToken && notificationUrl) {
      const paymentResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mpToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": booking.appointment_id,
        },
        body: JSON.stringify({
          transaction_amount: Number(booking.amount),
          description: "Agendamento Dom Navalha Barbearia",
          payment_method_id: "pix",
          payer: { email: String(email).trim().toLowerCase() },
          external_reference: booking.appointment_id,
          notification_url: notificationUrl,
        }),
      });

      const payment = await paymentResponse.json();
      if (!paymentResponse.ok) {
        // A reserva permanece pendente; não marcar como paga.
        return response({
          success: true,
          appointment: booking,
          payment: null,
          message: "Reserva criada, mas não foi possível gerar o Pix. Entre em contato com a barbearia.",
        });
      }

      const { error: insertPaymentError } = await admin.from("payments").insert({
        appointment_id: booking.appointment_id,
        amount: Number(booking.amount),
        provider: "mercadopago",
        provider_payment_id: String(payment.id),
        status: "pending",
      });
      if (insertPaymentError) throw new Error("Pagamento criado, mas não foi possível registrar a cobrança. Contate o suporte.");

      return response({
        success: true,
        appointment: booking,
        payment: {
          provider: "mercadopago",
          status: payment.status,
          qrCode: payment.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
          qrCodeText: payment.point_of_interaction?.transaction_data?.qr_code ?? null,
          ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url ?? null,
        },
      });
    }

    return response({
      success: true,
      appointment: booking,
      payment: null,
      message: "Agendamento recebido. O pagamento online ainda não foi configurado.",
    });
  } catch (error) {
    console.error("create-appointment:", error);
    return response({
      success: false,
      message: error instanceof Error ? error.message : "Erro interno ao criar agendamento.",
    }, 400);
  }
});
