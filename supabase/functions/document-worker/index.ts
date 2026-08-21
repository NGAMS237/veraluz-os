// ═══════════════════════════════════════════════════════════════════════════
// document-worker — INFRA-DOCS-1 (Phases 3-4)
// Génération déterministe de PDFs financiers.
// Accès : service_role UNIQUEMENT (Bearer exact match).
// INTERDIT : appeler depuis frontend / broker / guest-access.
// INTERDIT : IA pour calcul / montant / ligne / numéro / rendu.
// INTERDIT : stocker API key / secret / token / password / credentials.
// Deux types gérés :
//   payment_receipt — reçu de paiement (event payment_recorded)
//   stay_folio      — décompte fin de séjour (event guest_checked_out)
// Formule SSOT :
//   lodging  = reservation.total (JAMAIS recalculé)
//   charges  = SUM(veraluz_room_charges.net_amount) hors type 'lodging'
//   gross    = lodging + charges
//   payments = SUM(veraluz_payments WHERE status='validated')
//   balance  = gross - payments
// ═══════════════════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';

const BATCH_SIZE          = 10;
const BUCKET              = 'veraluz-documents-private';
const PROPERTY_NAME       = 'Résidence Veraluz';
const PROPERTY_LOCATION   = 'Kribi, Cameroun';

// ── Helpers ─────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function fmtXAF(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'XAF', maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return d.slice(0, 10);
}

// ── PDF builders ─────────────────────────────────────────────────────────────

async function buildPaymentReceiptPdf(params: {
  receiptNumber: string;
  paymentDate:   string;
  guestName:     string;
  unitId:        string;
  checkIn:       string;
  checkOut:      string;
  methodLabel:   string;
  amount:        number;
  generatedAt:   string;
}): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 420]);  // A5 landscape
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const L = 40;  // left margin
  let y = height - 40;

  const drawLine = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });

  const row = (label: string, value: string) => {
    page.drawText(label, { x: L, y, font: reg, size: 10, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(value, { x: L + 180, y, font: bold, size: 10, color: rgb(0.1, 0.1, 0.1) });
    y -= 20;
    drawLine(L, y + 2, width - L, y + 2);
  };

  // Header
  page.drawText(PROPERTY_NAME, { x: L, y, font: bold, size: 16, color: rgb(0.05, 0.3, 0.55) });
  y -= 22;
  page.drawText('REÇU DE PAIEMENT', { x: L, y, font: bold, size: 13, color: rgb(0.1, 0.1, 0.1) });
  y -= 28;
  drawLine(L, y, width - L, y);
  y -= 18;

  row('N° Reçu',         params.receiptNumber);
  row('Date',            fmtDate(params.paymentDate));
  row('Client',          params.guestName || '—');
  row('Logement',        params.unitId    || '—');
  row('Séjour',          `${fmtDate(params.checkIn)} → ${fmtDate(params.checkOut)}`);
  row('Mode paiement',   params.methodLabel);

  // Amount block
  y -= 12;
  page.drawRectangle({ x: L, y: y - 10, width: width - 2 * L, height: 44, color: rgb(0.93, 0.97, 0.93) });
  page.drawText('MONTANT REÇU', { x: L + 8, y: y + 22, font: bold, size: 9, color: rgb(0.25, 0.55, 0.25) });
  page.drawText(fmtXAF(params.amount), { x: L + 8, y: y + 4, font: bold, size: 20, color: rgb(0.05, 0.4, 0.1) });
  y -= 60;

  // Status
  page.drawText('✓ Paiement reçu et validé', { x: L, y, font: bold, size: 10, color: rgb(0.05, 0.4, 0.1) });
  y -= 30;

  // Footer
  drawLine(L, y, width - L, y);
  y -= 14;
  page.drawText(`${PROPERTY_NAME} · ${PROPERTY_LOCATION}`, { x: L, y, font: reg, size: 8, color: rgb(0.55, 0.55, 0.55) });
  y -= 12;
  page.drawText(`Document généré le ${fmtDate(params.generatedAt)}`, { x: L, y, font: reg, size: 8, color: rgb(0.55, 0.55, 0.55) });

  return doc.save();
}

async function buildStayFolioPdf(params: {
  reservationId: string;
  guestName:     string;
  unitId:        string;
  checkIn:       string;
  checkOut:      string;
  lodging:       number;
  chargeLines:   { label: string; amount: number }[];
  gross:         number;
  payments:      { date: string; method: string; amount: number }[];
  totalPaid:     number;
  balance:       number;
  generatedAt:   string;
}): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]);  // A4 portrait
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const L  = 40;
  let y    = height - 44;

  const drawHRule = () => {
    page.drawLine({ start: { x: L, y }, end: { x: width - L, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  };

  const section = (title: string) => {
    y -= 6;
    page.drawText(title, { x: L, y, font: bold, size: 9, color: rgb(0.3, 0.3, 0.3) });
    y -= 4;
    page.drawLine({ start: { x: L, y }, end: { x: width - L, y }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;
  };

  const row2col = (label: string, value: string, isTotal = false) => {
    const f = isTotal ? bold : reg;
    const c = isTotal ? rgb(0.05, 0.05, 0.4) : rgb(0.15, 0.15, 0.15);
    page.drawText(label, { x: L + 4, y, font: f, size: 9.5, color: c });
    page.drawText(value, { x: width - L - 100, y, font: f, size: 9.5, color: c });
    y -= 17;
  };

  // ── Header ────────────────────────────────────────────────────────────
  page.drawText(PROPERTY_NAME, { x: L, y, font: bold, size: 16, color: rgb(0.05, 0.3, 0.55) });
  page.drawText('DÉCOMPTE DE SÉJOUR', { x: width - L - 170, y, font: bold, size: 12, color: rgb(0.1, 0.1, 0.1) });
  y -= 22;
  page.drawText(PROPERTY_LOCATION, { x: L, y, font: reg, size: 9, color: rgb(0.45, 0.45, 0.45) });
  y -= 20;
  drawHRule();
  y -= 16;

  // ── Infos réservation ──────────────────────────────────────────────────
  section('INFORMATIONS SÉJOUR');
  row2col('Client',      params.guestName          || '—');
  row2col('Logement',    params.unitId              || '—');
  row2col('Arrivée',     fmtDate(params.checkIn));
  row2col('Départ',      fmtDate(params.checkOut));
  row2col('N° Réservation', params.reservationId.slice(-8).toUpperCase());
  y -= 6;
  drawHRule();

  // ── Prestations ────────────────────────────────────────────────────────
  section('DÉTAIL DES PRESTATIONS');
  row2col('Hébergement', fmtXAF(params.lodging));
  for (const line of params.chargeLines) {
    row2col(line.label, fmtXAF(line.amount));
  }
  y -= 4;
  row2col('TOTAL BRUT', fmtXAF(params.gross), true);
  y -= 4;
  drawHRule();

  // ── Paiements reçus ────────────────────────────────────────────────────
  section('PAIEMENTS REÇUS');
  const methodLabels: Record<string, string> = {
    cash: 'Espèces', card: 'Carte', mobile_money: 'Mobile Money',
    bank_transfer: 'Virement', other: 'Autre',
  };
  for (const p of params.payments) {
    const m = methodLabels[p.method] ?? p.method ?? 'Autre';
    row2col(`${fmtDate(p.date)} — ${m}`, fmtXAF(p.amount));
  }
  if (params.payments.length === 0) row2col('(aucun paiement enregistré)', '');
  y -= 4;
  row2col('TOTAL PAYÉ', fmtXAF(params.totalPaid), true);
  y -= 4;
  drawHRule();

  // ── Solde ──────────────────────────────────────────────────────────────
  y -= 10;
  const balColor = params.balance <= 0 ? rgb(0.05, 0.4, 0.1) : rgb(0.55, 0.1, 0.1);
  const balLabel = params.balance <= 0 ? 'SOLDE (CRÉDIT CLIENT)' : 'SOLDE RESTANT DÛ';
  page.drawRectangle({ x: L, y: y - 10, width: width - 2 * L, height: 42, color: rgb(0.95, 0.97, 1.0) });
  page.drawText(balLabel, { x: L + 8, y: y + 18, font: bold, size: 9, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(fmtXAF(Math.abs(params.balance)), { x: L + 8, y: y + 2, font: bold, size: 18, color: balColor });
  y -= 60;

  // ── Footer ─────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: L, y }, end: { x: width - L, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) });
  y -= 14;
  page.drawText(`${PROPERTY_NAME} · ${PROPERTY_LOCATION}`, { x: L, y, font: reg, size: 8, color: rgb(0.55, 0.55, 0.55) });
  y -= 12;
  page.drawText(`Document généré le ${fmtDate(params.generatedAt)}`, { x: L, y, font: reg, size: 8, color: rgb(0.55, 0.55, 0.55) });

  return doc.save();
}

// ── Document generation handlers ─────────────────────────────────────────────

interface DocJob {
  id:                string;
  event_id:          string;
  document_type:     string;
  related_record_id: string;
  attempt:           number;
  max_attempts:      number;
}

interface JobResult {
  job_id:       string;
  document_type: string;
  status:       string;
  attempt:      number;
  error?:       string;
}

async function generatePaymentReceipt(
  admin: ReturnType<typeof createClient>,
  job:   DocJob,
  generatedAt: string,
): Promise<void> {
  const paymentId = job.related_record_id;

  const { data: pay, error: payErr } = await admin
    .from('veraluz_payments')
    .select('id, reservation_id, amount, method, status, guest_name, created_at')
    .eq('id', paymentId)
    .eq('status', 'validated')
    .single();

  if (payErr || !pay) throw new Error(`payment_not_found: ${paymentId}`);

  const { data: res, error: resErr } = await admin
    .from('veraluz_reservations')
    .select('id, client_name, unit_id, check_in, check_out')
    .eq('id', pay.reservation_id)
    .single();

  if (resErr || !res) throw new Error(`reservation_not_found: ${pay.reservation_id}`);

  const methodLabels: Record<string, string> = {
    cash: 'Espèces', card: 'Carte bancaire', mobile_money: 'Mobile Money',
    bank_transfer: 'Virement bancaire', other: 'Autre',
  };

  const receiptNumber = `VLZ-${(pay.id as string).slice(-8).toUpperCase()}`;
  const pdfBytes = await buildPaymentReceiptPdf({
    receiptNumber,
    paymentDate: pay.created_at as string,
    guestName:   (res.client_name ?? pay.guest_name ?? '—') as string,
    unitId:      (res.unit_id ?? '—') as string,
    checkIn:     res.check_in  as string,
    checkOut:    res.check_out as string,
    methodLabel: methodLabels[(pay.method as string) ?? 'other'] ?? ((pay.method as string) ?? 'Autre'),
    amount:      (pay.amount as number) ?? 0,
    generatedAt,
  });

  const storagePath = `payment_receipt/${paymentId}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);

  await admin.from('veraluz_documents').upsert({
    document_type:     'payment_receipt',
    related_module:    'payments',
    related_record_id: paymentId,
    reservation_id:    pay.reservation_id as string,
    storage_path:      storagePath,
    status:            'completed',
    generated_at:      generatedAt,
    file_size_bytes:   pdfBytes.byteLength,
    error_message:     null,
    updated_at:        generatedAt,
  }, { onConflict: 'document_type,related_record_id' });
}

async function generateStayFolio(
  admin: ReturnType<typeof createClient>,
  job:   DocJob,
  generatedAt: string,
): Promise<void> {
  const reservationId = job.related_record_id;

  const { data: res, error: resErr } = await admin
    .from('veraluz_reservations')
    .select('id, client_name, unit_id, check_in, check_out, total')
    .eq('id', reservationId)
    .single();

  if (resErr || !res) throw new Error(`reservation_not_found: ${reservationId}`);

  // Charges hors hébergement (SSOT : veraluz_room_charges)
  const { data: charges } = await admin
    .from('veraluz_room_charges')
    .select('description, charge_type, net_amount')
    .eq('reservation_id', reservationId)
    .neq('charge_type', 'lodging');

  // Paiements validés uniquement
  const { data: payments } = await admin
    .from('veraluz_payments')
    .select('amount, method, created_at')
    .eq('reservation_id', reservationId)
    .eq('status', 'validated')
    .order('created_at', { ascending: true });

  // ── Formule SSOT ──────────────────────────────────────────────────────────
  const lodging    = (res.total as number) ?? 0;              // JAMAIS recalculé
  const chargeSum  = (charges ?? []).reduce((s, c) => s + ((c.net_amount as number) ?? 0), 0);
  const gross      = lodging + chargeSum;
  const totalPaid  = (payments ?? []).reduce((s, p) => s + ((p.amount as number) ?? 0), 0);
  const balance    = gross - totalPaid;

  const chargeLines = (charges ?? []).map(c => ({
    label:  (c.description as string) || (c.charge_type as string) || 'Autre',
    amount: (c.net_amount  as number) ?? 0,
  }));

  const paymentLines = (payments ?? []).map(p => ({
    date:   (p.created_at as string) ?? '',
    method: (p.method     as string) ?? 'other',
    amount: (p.amount     as number) ?? 0,
  }));

  const pdfBytes = await buildStayFolioPdf({
    reservationId,
    guestName:   (res.client_name ?? '—') as string,
    unitId:      (res.unit_id     ?? '—') as string,
    checkIn:     (res.check_in    ?? '')  as string,
    checkOut:    (res.check_out   ?? '')  as string,
    lodging,
    chargeLines,
    gross,
    payments:    paymentLines,
    totalPaid,
    balance,
    generatedAt,
  });

  const storagePath = `stay_folio/${reservationId}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);

  await admin.from('veraluz_documents').upsert({
    document_type:     'stay_folio',
    related_module:    'reservations',
    related_record_id: reservationId,
    reservation_id:    reservationId,
    storage_path:      storagePath,
    status:            'completed',
    generated_at:      generatedAt,
    file_size_bytes:   pdfBytes.byteLength,
    error_message:     null,
    updated_at:        generatedAt,
  }, { onConflict: 'document_type,related_record_id' });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const url        = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ── Auth : service_role uniquement ────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: 'service_role_required' }, 403);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Lire worker_id depuis body (transmis par infra-scheduler) ─────────────
  let worker_id = '';
  try {
    const b = await req.json() as Record<string, unknown>;
    worker_id = (b['worker_id'] as string) || '';
  } catch { /* body vide ou absent */ }

  const t0 = Date.now();

  // ── Claim jobs ────────────────────────────────────────────────────────────
  const { data: jobs, error: claimErr } = await admin
    .rpc('claim_document_jobs', {
      p_batch:     BATCH_SIZE,
      p_worker_id: worker_id || null,
    });

  if (claimErr) {
    console.error('[document-worker] claim_document_jobs error:', claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  const claimed = (jobs as DocJob[]) ?? [];
  const results: JobResult[] = [];

  // ── Traiter chaque job ────────────────────────────────────────────────────
  for (const job of claimed) {
    const generatedAt = new Date().toISOString();
    try {
      if (job.document_type === 'payment_receipt') {
        await generatePaymentReceipt(admin, job, generatedAt);
      } else if (job.document_type === 'stay_folio') {
        await generateStayFolio(admin, job, generatedAt);
      } else {
        throw new Error(`unknown_document_type: ${job.document_type}`);
      }

      // Marquer completed
      await admin.from('veraluz_document_jobs').update({
        status:       'completed',
        processed_at: generatedAt,
        last_error:   null,
        updated_at:   generatedAt,
      }).eq('id', job.id);

      results.push({ job_id: job.id, document_type: job.document_type, status: 'completed', attempt: job.attempt });

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const attempt = job.attempt;
      const isDead  = attempt >= job.max_attempts;
      const nextStatus = isDead ? 'dead' : 'failed';

      // Mettre à jour le doc row comme failed si elle existe
      await admin.from('veraluz_documents').upsert({
        document_type:     job.document_type,
        related_module:    job.document_type === 'payment_receipt' ? 'payments' : 'reservations',
        related_record_id: job.related_record_id,
        reservation_id:    job.related_record_id,  // approximatif pour payment_receipt mais acceptable
        storage_path:      `${job.document_type}/${job.related_record_id}.pdf`,
        status:            'failed',
        error_message:     errMsg.slice(0, 500),
        updated_at:        generatedAt,
      }, { onConflict: 'document_type,related_record_id' });

      await admin.from('veraluz_document_jobs').update({
        status:       nextStatus,
        last_error:   errMsg.slice(0, 500),
        processed_at: generatedAt,
        updated_at:   generatedAt,
      }).eq('id', job.id);

      console.error(`[document-worker] job=${job.id} type=${job.document_type} attempt=${attempt} error:`, errMsg);
      results.push({ job_id: job.id, document_type: job.document_type, status: nextStatus, attempt, error: errMsg });
    }
  }

  const completed = results.filter(r => r.status === 'completed').length;
  const failed    = results.filter(r => r.status === 'failed').length;
  const dead      = results.filter(r => r.status === 'dead').length;

  console.log(
    `[document-worker] worker_id=${worker_id} processed=${results.length}` +
    ` completed=${completed} failed=${failed} dead=${dead}` +
    ` duration_ms=${Date.now() - t0}`,
  );

  return json({
    ok:          true,
    processed:   results.length,
    completed,
    failed,
    dead,
    duration_ms: Date.now() - t0,
  });
});
