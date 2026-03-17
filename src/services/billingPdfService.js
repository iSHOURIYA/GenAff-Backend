const PDFDocument = require('pdfkit');
const prisma = require('./prismaClient');

const BRAND = {
  name: process.env.BILLING_COMPANY_NAME || 'GenAff',
  website: process.env.BILLING_COMPANY_WEBSITE || 'https://genaff.shauryacodes.xyz',
  supportEmail: process.env.BILLING_SUPPORT_EMAIL || 'support@genaff.shauryacodes.xyz',
  signatory: process.env.BILLING_SIGNATORY_NAME || 'Ishouriya',
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
  doc.fontSize(26).text(BRAND.name, { align: 'left' });
  doc.fontSize(10).fillColor('#666').text(BRAND.website);
  doc.text(BRAND.supportEmail);
  doc.moveDown();
  doc.fillColor('#111').fontSize(18).text(title, { align: 'right' });
  doc.moveDown(1.5);
}

function drawSignature(doc) {
  doc.moveDown(2);
  doc.fontSize(10).fillColor('#111').text('Authorised Signatory', { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(16).text(BRAND.signatory, { align: 'right' });
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

    doc.fontSize(11)
      .text(`Invoice No: INV-${topUp.id.slice(0, 8).toUpperCase()}`)
      .text(`Invoice Date: ${formatDate(topUp.created_at)}`)
      .text(`Customer: ${topUp.user.email}`)
      .text(`Customer ID: ${topUp.user.id}`)
      .moveDown();

    doc.fontSize(12).text('Description', 50, doc.y, { continued: true });
    doc.text('Amount', 430, doc.y, { align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11)
      .text(`Wallet Top-up (${topUp.razorpay_payment_id || 'manual confirmation'})`, 50, doc.y, { continued: true })
      .text(moneyInr(topUp.amount), 430, doc.y, { align: 'right' });

    doc.moveDown(0.6);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(12)
      .text('Total Paid', 50, doc.y, { continued: true })
      .text(moneyInr(topUp.amount), 430, doc.y, { align: 'right' });

    doc.moveDown(1.2);
    doc.fontSize(10).fillColor('#666')
      .text(`Razorpay Order ID: ${topUp.razorpay_order_id || '-'}`)
      .text(`Razorpay Payment ID: ${topUp.razorpay_payment_id || '-'}`)
      .text(`Status: ${topUp.status}`);

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

    doc.fontSize(11)
      .text(`Account: ${user.email}`)
      .text(`Customer ID: ${user.id}`)
      .text(`Period: ${formatDate(fromDate)} to ${formatDate(toDate)}`)
      .moveDown();

    doc.fontSize(11)
      .text(`Total Credits: ${moneyInr(totalCredits)}`)
      .text(`Total Debits: ${moneyInr(totalDebits)}`)
      .text(`Net Change: ${moneyInr(totalCredits - totalDebits)}`)
      .moveDown();

    doc.fontSize(11).text('Date', 50, doc.y, { continued: true });
    doc.text('Type', 170, doc.y, { continued: true });
    doc.text('Description', 240, doc.y, { continued: true });
    doc.text('Amount', 430, doc.y, { align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    if (rows.length === 0) {
      doc.fontSize(11).text('No transactions in selected period.');
    } else {
      rows.forEach((row) => {
        if (doc.y > 740) doc.addPage();
        doc.fontSize(10)
          .text(formatDate(row.date), 50, doc.y, { continued: true, width: 110 })
          .text(row.type, 170, doc.y, { continued: true, width: 60 })
          .text(row.description, 240, doc.y, { continued: true, width: 170 })
          .text(`${row.type === 'DEBIT' ? '-' : '+'}${moneyInr(row.amount).replace('₹', '')}`, 430, doc.y, { align: 'right' });
      });
    }

    drawSignature(doc);
  });
}

module.exports = {
  generateTopUpInvoicePdf,
  generateWalletStatementPdf,
};
