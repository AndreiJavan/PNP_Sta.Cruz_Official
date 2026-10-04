-- =====================================================
-- STA. CRUZ CRIME MAPPING DATABASE SCHEMA (CLEAN VERSION)
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- USERS
-- =====================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('superadmin', 'staff')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INTELLIGENCE SCANS
-- =====================================================
CREATE TABLE public.intelligence_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES public.users(id),
  admin_name TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_records INTEGER,
  category_stats JSONB,
  raw_data JSONB,
  filename TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INCIDENT REPORTS
-- =====================================================
CREATE TABLE public.incident_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  location_text TEXT NOT NULL,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  description TEXT NOT NULL,
  photo_path TEXT,
  contact_info TEXT,
  status TEXT DEFAULT 'Received'
    CHECK (status IN ('Received', 'Under Review', 'Resolved', 'Closed')),
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- BULLETINS (FIXED FOR YOUR SYSTEM)
-- =====================================================
CREATE TABLE public.bulletins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,

  -- IMPORTANT FIX:
  -- allows BOTH predefined + custom categories
  category TEXT NOT NULL,

  body TEXT NOT NULL,
  photo_path TEXT,

  is_archived BOOLEAN DEFAULT FALSE,

  posted_by UUID REFERENCES public.users(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);



-- =====================================================
-- MAP POINTS
-- =====================================================
CREATE TABLE public.map_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES public.intelligence_scans(id),

  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,

  incident_type TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,

  barangay TEXT,
  category TEXT,

  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- HOTLINES
-- =====================================================
CREATE TABLE public.hotlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  number TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AUDIT LOGS
-- =====================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES public.users(id),
  username TEXT,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT, -- (FIXED: your error was missing this column)
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ADMIN NOTIFICATIONS
-- =====================================================
CREATE TABLE public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT,
  type TEXT,
  message TEXT NOT NULL,
  reference_id TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- RECYCLE BIN / ARCHIVE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.recycle_bin (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  original_id TEXT,
  payload JSONB,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- RLS (ALLOW ALL - DEV MODE)
-- =====================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN (
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow All" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "Allow All" ON public.%I
       FOR ALL USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

-- =====================================================
-- SEED USERS
-- =====================================================
INSERT INTO public.users (id, username, full_name, password_hash, role)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'superadmin',
   'Super Administrator',
   '$2a$10$DMpQH4fGsPrzMYMTWe/pIeOUF2eID.ay62ZxVAkvsF24VjNgO5h3y',
   'superadmin'
  )
ON CONFLICT DO NOTHING;

-- =====================================================
-- REFRESH SCHEMA CACHE
-- =====================================================
NOTIFY pgrst, 'reload schema';

-- =====================================================
-- FIX FOR BULLETINS CATEGORY CONSTRAINT
-- Run this block in your Supabase SQL Editor to fix the 
-- "violates check constraint 'bulletins_category_check'" error.
-- =====================================================
ALTER TABLE public.bulletins DROP CONSTRAINT IF EXISTS bulletins_category_check;

-- =====================================================
-- OPTIONAL: FACEBOOK POST ID & VIDEO COLUMNS FOR BULLETINS
-- If you wish to add dedicated database columns in Supabase:
-- =====================================================
ALTER TABLE public.bulletins ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;
ALTER TABLE public.bulletins ADD COLUMN IF NOT EXISTS video_paths TEXT;
ALTER TABLE public.bulletins ADD COLUMN IF NOT EXISTS video_path TEXT;

-- =====================================================
-- ANONYMOUS TIPS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.anonymous_tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT,
  description TEXT,
  location TEXT,
  photo_path TEXT,
  status TEXT DEFAULT 'Unread',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PERFORMANCE INDEXING (ADMIN & PUBLIC WORKLOADS)
-- Run this section in Supabase SQL Editor to accelerate
-- query responses and eliminate full table scans.
-- =====================================================

-- 1. Map Points Indexes (Map queries, incident range filters, spatial lookups)
CREATE INDEX IF NOT EXISTS idx_map_points_incident_date ON public.map_points (incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_map_points_barangay ON public.map_points (barangay);
CREATE INDEX IF NOT EXISTS idx_map_points_category ON public.map_points (category);
CREATE INDEX IF NOT EXISTS idx_map_points_incident_type ON public.map_points (incident_type);
CREATE INDEX IF NOT EXISTS idx_map_points_report_id ON public.map_points (report_id);
CREATE INDEX IF NOT EXISTS idx_map_points_created_at ON public.map_points (created_at DESC);

-- 2. Bulletins Indexes (Advisory listings, Wanted/Missing persons, News feeds)
CREATE INDEX IF NOT EXISTS idx_bulletins_created_at ON public.bulletins (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulletins_category ON public.bulletins (category);
CREATE INDEX IF NOT EXISTS idx_bulletins_is_archived ON public.bulletins (is_archived);
CREATE INDEX IF NOT EXISTS idx_bulletins_posted_by ON public.bulletins (posted_by);

-- 3. Incident Reports Indexes (Intelligence & tactical reports)
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON public.incident_reports (status);
CREATE INDEX IF NOT EXISTS idx_incident_reports_created_at ON public.incident_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_reports_incident_date ON public.incident_reports (incident_date DESC);

-- 4. Intelligence Scans Indexes (AI extractions & dashboard scan mapping)
CREATE INDEX IF NOT EXISTS idx_intelligence_scans_timestamp ON public.intelligence_scans (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_scans_admin_id ON public.intelligence_scans (admin_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_scans_created_at ON public.intelligence_scans (created_at DESC);

-- 5. Audit Logs Indexes (Admin operational activity timeline)
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON public.audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

-- 6. Admin Notifications Indexes (Dashboard unread alerts)
CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread ON public.admin_notifications (is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON public.admin_notifications (type);

-- 7. Anonymous Tips Indexes (Community tip inbox)
CREATE INDEX IF NOT EXISTS idx_anonymous_tips_created_at ON public.anonymous_tips (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anonymous_tips_status ON public.anonymous_tips (status);

-- 8. Hotlines Indexes (Public directory category grouping)
CREATE INDEX IF NOT EXISTS idx_hotlines_category ON public.hotlines (category);
CREATE INDEX IF NOT EXISTS idx_hotlines_name ON public.hotlines (name);

-- 9. Recycle Bin Indexes (Audit archive & recovery)
CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON public.recycle_bin (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_category ON public.recycle_bin (category);

-- 10. Users Indexes (Authentication & role permission lookups)
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (username);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users (created_at DESC);

NOTIFY pgrst, 'reload schema';


