const PDFDocument = require('pdfkit');
const prisma = require('./prismaClient');
const config = require('../config');

const BRAND = {
  name: config.BILLING_COMPANY_NAME,
  website: config.BILLING_COMPANY_WEBSITE,
  supportEmail: config.BILLING_SUPPORT_EMAIL,
  signatory: config.BILLING_SIGNATORY_NAME,
};

const THEME = {
  primary: '#0B5FFF',
  heading: '#111827',
  muted: '#6B7280',
  border: '#D1D5DB',
  rowAlt: '#F9FAFB',
  cardBg: '#F3F4F6',
};

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function moneyInr(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function createPdfBuffer(renderFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderFn(doc);
    doc.end();
  });
}

function drawBrandHeader(doc, title) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const top = doc.y;

  doc.save();
  doc.roundedRect(x, top, width, 72, 8).fill(THEME.cardBg);
  doc.restore();

  doc.fillColor(THEME.primary).fontSize(24).text(BRAND.name, x + 16, top + 14);
  doc.fillColor(THEME.muted).fontSize(10)
    .text(BRAND.website, x + 16, top + 44)
    .text(BRAND.supportEmail, x + 16, top + 56);

  doc.fillColor(THEME.heading).fontSize(17).text(title, x + 290, top + 20, {
    width: width - 306,
    align: 'right',
  });

  doc.y = top + 88;
}

function drawSignature(doc) {
  if (doc.y > 710) {
    doc.addPage();
  }
  doc.moveDown(1.2);
  doc.strokeColor(THEME.border).lineWidth(1).moveTo(390, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(THEME.muted).text('Authorised Signatory', { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(15).fillColor(THEME.heading).text(BRAND.signatory, { align: 'right' });
}

function ensurePageSpace(doc, requiredHeight) {
  if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawSectionTitle(doc, text) {
  ensurePageSpace(doc, 36);
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(THEME.heading).text(text);
  doc.moveDown(0.2);
  doc.strokeColor(THEME.border).lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
}

function drawInfoCard(doc, rows, options = {}) {
  const x = options.x || 50;
  const width = options.width || 495;
  const rowHeight = options.rowHeight || 16;
  const paddingY = 12;
  const cardHeight = paddingY * 2 + rows.length * rowHeight;

  ensurePageSpace(doc, cardHeight + 8);
  const top = doc.y;

  doc.save();
  doc.roundedRect(x, top, width, cardHeight, 6).fill('#FFFFFF');
  doc.roundedRect(x, top, width, cardHeight, 6).strokeColor(THEME.border).lineWidth(1).stroke();
  doc.restore();

  let rowY = top + paddingY;
  rows.forEach(({ label, value }) => {
    doc.fontSize(10).fillColor(THEME.muted).text(label, x + 12, rowY, { width: 165 });
    doc.fontSize(10).fillColor(THEME.heading).text(String(value), x + 180, rowY, { width: width - 192 });
    rowY += rowHeight;
  });

  doc.y = top + cardHeight + 8;
}

function drawTxnTableHeader(doc) {
  ensurePageSpace(doc, 24);
  const y = doc.y;
  doc.save();
  doc.rect(50, y, 495, 22).fill(THEME.cardBg);
  doc.restore();

  doc.fontSize(10).fillColor(THEME.heading)
    .text('Date', 58, y + 6, { width: 105 })
    .text('Type', 168, y + 6, { width: 60 })
    .text('Description', 232, y + 6, { width: 210 })
    .text('Amount', 444, y + 6, { width: 93, align: 'right' });

  doc.y = y + 24;
}

function drawTxnRow(doc, row, rowIndex) {
  ensurePageSpace(doc, 20);
  const y = doc.y;

  if (rowIndex % 2 === 1) {
    doc.save();
    doc.rect(50, y, 495, 18).fill(THEME.rowAlt);
    doc.restore();
  }

  const amountText = `${row.type === 'DEBIT' ? '-' : '+'}${moneyInr(row.amount).replace('₹', '')}`;
  doc.fontSize(9).fillColor(THEME.heading)
    .text(formatDate(row.date), 58, y + 5, { width: 105 })
    .text(row.type, 168, y + 5, { width: 60 })
    .text(row.description, 232, y + 5, { width: 210 })
    .text(amountText, 444, y + 5, { width: 93, align: 'right' });

  doc.y = y + 18;
}

async function getTopUpForInvoice(userId, topUpId) {
  const topUp = await prisma.topUp.findFirst({
    where: { id: topUpId, user_id: userId },
    include: {
      user: {
        select: { id: true, email: true },
      },
    },
  });

  if (!topUp) {
    const err = new Error('Top-up not found');
    err.status = 404;
    throw err;
  }

  if (topUp.status !== 'completed') {
    const err = new Error('Invoice is available only for completed top-ups');
    err.status = 400;
    throw err;
  }

  return topUp;
}

async function generateTopUpInvoicePdf({ userId, topUpId }) {
  const topUp = await getTopUpForInvoice(userId, topUpId);

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, 'Payment Invoice');

    drawInfoCard(doc, [
      { label: 'Invoice No', value: `INV-${topUp.id.slice(0, 8).toUpperCase()}` },
      { label: 'Invoice Date', value: formatDate(topUp.created_at) },
      { label: 'Customer', value: topUp.user.email },
      { label: 'Customer ID', value: topUp.user.id },
      { label: 'Status', value: String(topUp.status).toUpperCase() },
    ]);

    drawSectionTitle(doc, 'Charges');
    drawTxnTableHeader(doc);
    drawTxnRow(doc, {
      date: topUp.created_at,
      type: 'CREDIT',
      description: `Wallet Top-up (${topUp.razorpay_payment_id || 'manual confirmation'})`,
      amount: Number(topUp.amount),
    }, 0);

    doc.moveDown(0.7);
    doc.fontSize(12).fillColor(THEME.heading).text(`Total Paid: ${moneyInr(topUp.amount)}`, 50, doc.y, {
      align: 'right',
      width: 495,
    });

    drawSectionTitle(doc, 'Payment Reference');
    drawInfoCard(doc, [
      { label: 'Razorpay Order ID', value: topUp.razorpay_order_id || '-' },
      { label: 'Razorpay Payment ID', value: topUp.razorpay_payment_id || '-' },
    ]);

    drawSignature(doc);
  });
}

function parseDateRange(from, to) {
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    const err = new Error('Invalid date format. Use YYYY-MM-DD');
    err.status = 400;
    throw err;
  }

  if (fromDate > toDate) {
    const err = new Error('"from" date must be before "to" date');
    err.status = 400;
    throw err;
  }

  return { fromDate, toDate };
}

async function getStatementRows(userId, fromDate, toDate) {
  const [user, topUps, usages] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
    prisma.topUp.findMany({
      where: { user_id: userId, status: 'completed', created_at: { gte: fromDate, lte: toDate } },
      orderBy: { created_at: 'asc' },
      select: { id: true, amount: true, created_at: true, razorpay_payment_id: true },
    }),
    prisma.usage.findMany({
      where: { user_id: userId, created_at: { gte: fromDate, lte: toDate } },
      orderBy: { created_at: 'asc' },
      select: { id: true, model: true, tokens_used: true, cost_inr: true, created_at: true },
    }),
  ]);

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const rows = [
    ...topUps.map((item) => ({
      date: item.created_at,
      type: 'CREDIT',
      description: `Top-up (${item.razorpay_payment_id || item.id.slice(0, 8)})`,
      amount: Number(item.amount),
    })),
    ...usages.map((item) => ({
      date: item.created_at,
      type: 'DEBIT',
      description: `${item.model} · ${item.tokens_used} tokens`,
      amount: Number(item.cost_inr),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return { user, rows };
}

async function getCombinedBillingData(userId, fromDate, toDate, topUpId) {
  const [user, topUps, usages] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
    prisma.topUp.findMany({
      where: { user_id: userId, status: 'completed', created_at: { gte: fromDate, lte: toDate } },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        amount: true,
        created_at: true,
        razorpay_order_id: true,
        razorpay_payment_id: true,
        status: true,
      },
    }),
    prisma.usage.findMany({
      where: { user_id: userId, created_at: { gte: fromDate, lte: toDate } },
      orderBy: { created_at: 'asc' },
      select: { id: true, model: true, tokens_used: true, cost_inr: true, created_at: true },
    }),
  ]);

  const selectedTopUp = topUpId
    ? await prisma.topUp.findFirst({
        where: { id: topUpId, user_id: userId },
        select: {
          id: true,
          amount: true,
          created_at: true,
          razorpay_order_id: true,
          razorpay_payment_id: true,
          status: true,
        },
      })
    : null;

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (topUpId && !selectedTopUp) {
    const err = new Error('Top-up not found for this user');
    err.status = 404;
    throw err;
  }

  if (selectedTopUp && selectedTopUp.status !== 'completed') {
    const err = new Error('Selected top-up is not completed');
    err.status = 400;
    throw err;
  }

  const statementRows = [
    ...topUps.map((item) => ({
      date: item.created_at,
      type: 'CREDIT',
      description: `Top-up (${item.razorpay_payment_id || item.id.slice(0, 8)})`,
      amount: Number(item.amount),
    })),
    ...usages.map((item) => ({
      date: item.created_at,
      type: 'DEBIT',
      description: `${item.model} · ${item.tokens_used} tokens`,
      amount: Number(item.cost_inr),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return { user, topUps, statementRows, selectedTopUp };
}

async function generateCombinedBillingPdf({ userId, from, to, topUpId }) {
  const { fromDate, toDate } = parseDateRange(from, to);
  const { user, topUps, statementRows, selectedTopUp } = await getCombinedBillingData(userId, fromDate, toDate, topUpId);

  let totalCredits = 0;
  let totalDebits = 0;
  statementRows.forEach((row) => {
    if (row.type === 'CREDIT') totalCredits += row.amount;
    if (row.type === 'DEBIT') totalDebits += row.amount;
  });

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, 'Billing Statement & Top-up Receipt');

    drawInfoCard(doc, [
      { label: 'Bill No', value: `BILL-${user.id.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-6)}` },
      { label: 'Generated On', value: formatDate(new Date()) },
      { label: 'Customer', value: user.email },
      { label: 'Customer ID', value: user.id },
      { label: 'Period', value: `${formatDate(fromDate)} to ${formatDate(toDate)}` },
    ]);

    if (selectedTopUp) {
      drawSectionTitle(doc, 'Selected Top-up Receipt');
      drawInfoCard(doc, [
        { label: 'Top-up ID', value: selectedTopUp.id },
        { label: 'Top-up Date', value: formatDate(selectedTopUp.created_at) },
        { label: 'Amount Paid', value: moneyInr(selectedTopUp.amount) },
        { label: 'Razorpay Order ID', value: selectedTopUp.razorpay_order_id || '-' },
        { label: 'Razorpay Payment ID', value: selectedTopUp.razorpay_payment_id || '-' },
        { label: 'Status', value: String(selectedTopUp.status).toUpperCase() },
      ]);
    }

    drawSectionTitle(doc, 'Summary');
    drawInfoCard(doc, [
      { label: 'Total Top-ups (Credits)', value: moneyInr(totalCredits) },
      { label: 'Total Usage (Debits)', value: moneyInr(totalDebits) },
      { label: 'Net Change', value: moneyInr(totalCredits - totalDebits) },
    ]);

    drawSectionTitle(doc, 'Top-up Receipts in Period');
    if (topUps.length === 0) {
      doc.fontSize(10).fillColor(THEME.muted).text('No completed top-ups in selected period.');
      doc.moveDown();
    } else {
      drawTxnTableHeader(doc);
      topUps.forEach((t, index) => {
        drawTxnRow(doc, {
          date: t.created_at,
          type: 'CREDIT',
          description: `Top-up (${t.razorpay_payment_id || t.id.slice(0, 8)})`,
          amount: Number(t.amount),
        }, index);
      });
      doc.moveDown();
    }

    drawSectionTitle(doc, 'Statement Transactions');
    drawTxnTableHeader(doc);

    if (statementRows.length === 0) {
      doc.fontSize(10).fillColor(THEME.muted).text('No transactions in selected period.');
    } else {
      statementRows.forEach((row, index) => {
        if (doc.y > 742) {
          doc.addPage();
          drawBrandHeader(doc, 'Billing Statement (Continued)');
          drawSectionTitle(doc, 'Statement Transactions (Continued)');
          drawTxnTableHeader(doc);
        }
        drawTxnRow(doc, row, index);
      });
    }

    drawSignature(doc);
  });
}

async function generateWalletStatementPdf({ userId, from, to }) {
  const { fromDate, toDate } = parseDateRange(from, to);
  const { user, rows } = await getStatementRows(userId, fromDate, toDate);

  let totalCredits = 0;
  let totalDebits = 0;
  rows.forEach((row) => {
    if (row.type === 'CREDIT') totalCredits += row.amount;
    if (row.type === 'DEBIT') totalDebits += row.amount;
  });

  return createPdfBuffer((doc) => {
    drawBrandHeader(doc, 'Wallet Statement');

    drawInfoCard(doc, [
      { label: 'Account', value: user.email },
      { label: 'Customer ID', value: user.id },
      { label: 'Period', value: `${formatDate(fromDate)} to ${formatDate(toDate)}` },
      { label: 'Total Credits', value: moneyInr(totalCredits) },
      { label: 'Total Debits', value: moneyInr(totalDebits) },
      { label: 'Net Change', value: moneyInr(totalCredits - totalDebits) },
    ]);

    drawSectionTitle(doc, 'Transactions');
    drawTxnTableHeader(doc);

    if (rows.length === 0) {
      doc.fontSize(10).fillColor(THEME.muted).text('No transactions in selected period.');
    } else {
      rows.forEach((row, index) => {
        if (doc.y > 742) {
          doc.addPage();
          drawBrandHeader(doc, 'Wallet Statement (Continued)');
          drawSectionTitle(doc, 'Transactions (Continued)');
          drawTxnTableHeader(doc);
        }
        drawTxnRow(doc, row, index);
      });
    }

    drawSignature(doc);
  });
}

module.exports = {
  generateTopUpInvoicePdf,
  generateWalletStatementPdf,
  generateCombinedBillingPdf,
};
