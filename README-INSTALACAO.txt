DOM NAVALHA BARBEARIA — PROJETO COMPLETO
========================================

ESTRUTURA
- index.html: página principal.
- css/style.css: visual responsivo.
- js/: aplicação, autenticação, agendamento e áreas por perfil.
- assets/: logotipo, capa e ícones provisórios.
- database/: schema, segurança e funções SQL.
- supabase/functions/: Edge Functions para agendamento e webhook Pix.
- manifest.webmanifest e sw.js: instalação PWA e cache da interface.

COMO EXECUTAR LOCALMENTE
1. Instale Node.js LTS.
2. Extraia a pasta.
3. Abra o terminal dentro de dom-navalha-app-completo.
4. Copie .env.example para .env.
5. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY com os dados do projeto.
6. Execute:
   npm install
   npm run start
7. Abra o endereço informado pelo Vite, normalmente http://localhost:5173.

CONFIGURAÇÃO SUPABASE
1. Crie um projeto Supabase.
2. No SQL Editor, execute nesta ordem:
   database/schema.sql
   database/security.sql
   database/functions.sql
3. Cadastre serviços, barbeiros, horários comerciais e escalas.
4. Crie contas no Supabase Auth.
5. Promova o proprietário manualmente no SQL Editor:
   UPDATE public.profiles SET role = 'admin' WHERE id = 'UUID-DA-CONTA';
6. Para barbeiro, atribua role='barber' e associe o UUID em public.barbers.user_id.
7. Configure e publique as Edge Functions:
   supabase functions deploy create-appointment
   supabase functions deploy pix-webhook
8. Configure secrets das Edge Functions:
   SUPABASE_URL
   SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   APP_ORIGIN
   MP_ACCESS_TOKEN
   MP_WEBHOOK_SECRET
   MP_NOTIFICATION_URL

SEGURANÇA
- A service_role só deve ficar nos secrets do Supabase. Nunca a publique no frontend.
- A chave anon/public pode estar no frontend quando as políticas RLS estão corretamente configuradas.
- Configure APP_ORIGIN com o domínio real.
- O SQL e as Edge Functions precisam ser testados no seu próprio projeto antes da publicação.

PIX
A implementação fornecida é uma integração inicial com Mercado Pago.
É necessário configurar credenciais, URL de webhook e segredo de assinatura no painel do provedor.
Faça testes com pagamentos de teste e valide a assinatura no ambiente real antes de aceitar pagamentos.

IMPORTANTE
- O painel administrativo e o painel do barbeiro são módulos JavaScript de operações de dados,
  não páginas HTML completas com interface visual.
- O frontend de cliente precisa ser conectado à tela de perfil desejada.
- O projeto não foi executado contra o seu Supabase nem validado com suas credenciais.
- Imagens de marca incluídas são provisórias; substitua por fotos e logotipo oficiais.
- Não publique como sistema financeiro/agenda de produção sem testes completos de autenticação,
  RLS, concorrência de reservas, horários, cancelamentos, webhook e pagamentos.
