-- CPICRS PostgreSQL Schema for Supabase
-- This script sets up the database structure in the 'public' schema.
-- IMPORTANT: Run this in the Supabase SQL Editor and ensure RLS is handled.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. DROP EXISTING TABLES (CAUTION: Clean slate)
DROP TABLE IF EXISTS public.admin_notifications CASCADE;
DROP TABLE IF EXISTS public.intelligence_scans CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.hotlines CASCADE;
DROP TABLE IF EXISTS public.map_points CASCADE;
DROP TABLE IF EXISTS public.anonymous_tips CASCADE;
DROP TABLE IF EXISTS public.bulletins CASCADE;
DROP TABLE IF EXISTS public.incident_reports CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- 2. CREATE TABLES

-- Table: users
CREATE TABLE public.users (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('superadmin', 'staff')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: intelligence_scans
CREATE TABLE public.intelligence_scans (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  admin_id TEXT REFERENCES public.users(id),
  admin_name TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_records INTEGER,
  category_stats JSONB,
  raw_data JSONB,
  filename TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: incident_reports
CREATE TABLE public.incident_reports (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  tracking_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  location_text TEXT NOT NULL,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  description TEXT NOT NULL,
  photo_path TEXT,
  contact_info TEXT,
  status TEXT DEFAULT 'Received' CHECK (status IN ('Received', 'Under Review', 'Resolved', 'Closed')),
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: bulletins
CREATE TABLE public.bulletins (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  title TEXT NOT NULL,
  category TEXT CHECK (category IN ('Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement')) NOT NULL,
  body TEXT NOT NULL,
  photo_path TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  posted_by TEXT REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: anonymous_tips
CREATE TABLE public.anonymous_tips (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  tip_id TEXT UNIQUE NOT NULL,
  concern_type TEXT NOT NULL,
  location_text TEXT NOT NULL,
  description TEXT NOT NULL,
  photo_path TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: map_points
CREATE TABLE public.map_points (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  report_id TEXT REFERENCES public.intelligence_scans(id),
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  incident_type TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  barangay TEXT,
  category TEXT, -- '8-Focus', 'PSI', 'Non-Index'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: hotlines
CREATE TABLE public.hotlines (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name TEXT NOT NULL,
  number TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: audit_logs
CREATE TABLE public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  admin_id TEXT REFERENCES public.users(id),
  username TEXT,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: admin_notifications
CREATE TABLE public.admin_notifications (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  title TEXT,
  type TEXT,
  message TEXT NOT NULL,
  reference_id TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ENABLE RLS AND CREATE PERMISSIVE POLICIES
-- This ensures that even if RLS is on, the 'anon' key can perform operations.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow All" ON public.%I;', t);
        EXECUTE format('CREATE POLICY "Allow All" ON public.%I FOR ALL USING (true) WITH CHECK (true);', t);
    END LOOP;
END $$;

-- 4. SEED INITIAL DATA
INSERT INTO public.users (id, username, full_name, password_hash, role)
VALUES 
  ('superadmin', 'superadmin', 'Super Administrator', '$2a$10$DMpQH4fGsPrzMYMTWe/pIeOUF2eID.ay62ZxVAkvsF24VjNgO5h3y', 'superadmin'),
  ('andreijavan06', 'andreijavan06@gmail.com', 'Andrei Javan', '$2a$10$DMpQH4fGsPrzMYMTWe/pIeOUF2eID.ay62ZxVAkvsF24VjNgO5h3y', 'superadmin')
ON CONFLICT (id) DO NOTHING;

-- 5. RELOAD SCHEMA CACHE (Critical for PostgREST)
NOTIFY pgrst, 'reload schema';
