// src/scripts/seedAdmin.ts
// Script to seed or update the primary administrator account for Ally-jis.

import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from '../config/supabase';

async function seedAdmin() {
  const adminEmail = 'admin@ally-jis.xyz';
  const adminPassword = '@adminallyjis';
  const adminUsername = 'admin';

  console.log(`Checking if admin user (${adminEmail}) exists...`);

  // 1. Check if user already exists in auth.users
  const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers();

  if (listError) {
    console.error('Failed to list users:', listError);
    process.exit(1);
  }

  let existingUser = userList.users.find(
    (u) => u.email?.toLowerCase() === adminEmail.toLowerCase()
  );

  let userId: string;

  if (existingUser) {
    console.log(`Admin user already exists with ID: ${existingUser.id}. Updating password & metadata...`);
    userId = existingUser.id;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        username: adminUsername,
        full_name: 'Administrator',
        role: 'super_admin',
        email_type: 'chmsu',
        chmsu_auto_verified: true,
        pending_student_verification: false,
        student_verification_status: 'approved',
        admin_verified: true,
        onboarding_complete: true,
      },
    });

    if (updateError) {
      console.error('Failed to update admin user:', updateError);
      process.exit(1);
    }
  } else {
    console.log(`Creating new admin user: ${adminEmail}...`);
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        username: adminUsername,
        full_name: 'Administrator',
        role: 'super_admin',
        email_type: 'chmsu',
        chmsu_auto_verified: true,
        pending_student_verification: false,
        student_verification_status: 'approved',
        admin_verified: true,
        onboarding_complete: true,
      },
    });

    if (createError || !newUser.user) {
      console.error('Failed to create admin user:', createError);
      process.exit(1);
    }

    userId = newUser.user.id;
  }

  // 2. Upsert profile in public.profiles with super_admin role & verified metadata
  console.log(`Ensuring profile record in public.profiles for ID: ${userId}...`);

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: userId,
      email: adminEmail,
      username: adminUsername,
      full_name: 'Administrator',
      role: 'super_admin',
      email_type: 'chmsu',
      chmsu_auto_verified: true,
      admin_verified: true,
      student_verification_status: 'approved',
      department: 'ADMIN',
      course: 'SYSTEM_ADMIN',
      year_level: '4th Year',
      bio: 'System Administrator Account',
      updated_at: new Date().toISOString(),
    });

  if (profileError) {
    console.error('Failed to upsert profile:', profileError);
    process.exit(1);
  }

  console.log(`✅ Admin account successfully created/updated!`);
  console.log(`   Email: ${adminEmail}`);
  console.log(`   Password: ${adminPassword}`);
  console.log(`   Role: super_admin`);
  console.log(`   Verified: true`);
  process.exit(0);
}

seedAdmin();
