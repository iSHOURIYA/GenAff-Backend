/**
 * Seed script: Create or update admin user
 * Usage: node scripts/seedAdmin.js
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { hashPassword } = require('../src/utils/hash');

async function seedAdmin() {
  try {
    const adminEmail = 'shouriyatayal1234@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe!123'; // Default password, user should change on first login

    console.log(`\n🔑 Seeding admin user: ${adminEmail}`);

    // Check if admin user exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingAdmin) {
      // Update existing user to ADMIN role
      const updated = await prisma.user.update({
        where: { email: adminEmail },
        data: { role: 'ADMIN' },
        select: { id: true, email: true, role: true }
      });
      console.log(`✅ Updated existing user to ADMIN role:`);
      console.log(`   Email: ${updated.email}`);
      console.log(`   Role:  ${updated.role}`);
    } else {
      // Create new admin user
      const passwordHash = await hashPassword(adminPassword);
      const created = await prisma.user.create({
        data: {
          email: adminEmail,
          password_hash: passwordHash,
          role: 'ADMIN',
          email_verified: true, // Admin email is pre-verified
          free_units: 0 // Admins don't need free units
        },
        select: { id: true, email: true, role: true, created_at: true }
      });
      console.log(`✅ Created new admin user:`);
      console.log(`   ID:       ${created.id}`);
      console.log(`   Email:    ${created.email}`);
      console.log(`   Role:     ${created.role}`);
      console.log(`   Created:  ${created.created_at}`);
      console.log(`   \n⚠️  Temporary password: ${adminPassword}`);
      console.log(`   ⚠️  Please change password on first login!\n`);
    }

    console.log(`\n✨ Admin seeding complete!\n`);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin();
