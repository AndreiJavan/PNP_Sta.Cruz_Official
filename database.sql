-- =====================================================
-- CPICRS SUPABASE DATABASE SCHEMA (CLEAN VERSION)
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
-- ANONYMOUS TIPS
-- =====================================================
CREATE TABLE public.anonymous_tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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