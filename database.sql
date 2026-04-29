<<<<<<< HEAD
-- CPICRS Database Dump (MySQL 8.0 Compatible)
-- Generated for PNP Sta. Cruz, Laguna

CREATE DATABASE IF NOT EXISTS cpicrs;
USE cpicrs;

-- Table: users
CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('superadmin', 'staff') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: public_users
CREATE TABLE public_users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: incident_reports (Kept for historical direct reports logging, unlinked from map_points)
CREATE TABLE incident_reports (
  id VARCHAR(50) PRIMARY KEY,
  tracking_number VARCHAR(20) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL,
  incident_date DATETIME NOT NULL,
  location_text TEXT NOT NULL,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  description TEXT NOT NULL,
  photo_path VARCHAR(255),
  contact_info VARCHAR(100),
  status ENUM('Received', 'Under Review', 'Resolved', 'Closed') DEFAULT 'Received',
  internal_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: bulletins
CREATE TABLE bulletins (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category ENUM('Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement') NOT NULL,
  body TEXT NOT NULL,
  photo_path VARCHAR(255),
  is_archived TINYINT(1) DEFAULT 0,
  posted_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

-- Table: anonymous_tips
CREATE TABLE anonymous_tips (
  id VARCHAR(50) PRIMARY KEY,
  tip_id VARCHAR(20) UNIQUE NOT NULL,
  concern_type VARCHAR(50) NOT NULL,
  location_text TEXT NOT NULL,
  description TEXT NOT NULL,
  photo_path VARCHAR(255),
  is_flagged TINYINT(1) DEFAULT 0,
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: map_points
CREATE TABLE map_points (
  id VARCHAR(50) PRIMARY KEY,
  barangay VARCHAR(100),
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  incident_type VARCHAR(50) NOT NULL,
  category VARCHAR(50),
  description TEXT,
  incident_date DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: hotlines
CREATE TABLE hotlines (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  number VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: audit_logs (Aligned with Data Layer)
CREATE TABLE audit_logs (
  id VARCHAR(50) PRIMARY KEY,
  admin_id VARCHAR(50),
  username VARCHAR(100),
  action VARCHAR(255) NOT NULL,
  details TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

-- Table: intelligence_scans
CREATE TABLE intelligence_scans (
  id VARCHAR(50) PRIMARY KEY,
  admin_id VARCHAR(50),
  admin_name VARCHAR(100),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_records INT,
  category_stats JSON,
  raw_data JSON
);

-- Table: admin_notifications
CREATE TABLE admin_notifications (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255),
  message TEXT,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data (Adjusted for string IDs where applicable)
INSERT INTO users (id, username, full_name, password_hash, role) VALUES 
('superadmin', 'superadmin', 'Super Administrator', '$2a$10$7v6E8Z9R9R9R9R9R9R9R9O', 'superadmin'),
('staff1', 'staff', 'PNP Staff Member', '$2a$10$7v6E8Z9R9R9R9R9R9R9R9O', 'staff');
-- (Note: Password hashes are placeholders, use bcrypt to generate real ones)

INSERT INTO hotlines (id, name, number, category) VALUES 
('hot1', 'PNP Sta. Cruz', '0912-345-6789', 'Police'),
('hot2', 'BFP Sta. Cruz', '0923-456-7890', 'Fire'),
('hot3', 'Sta. Cruz Rescue', '0934-567-8901', 'Emergency'),
('hot4', 'MDRRMO', '0945-678-9012', 'Disaster'),
('hot5', 'Red Cross Laguna', '0956-789-0123', 'Medical'),
('hot6', 'Laguna Medical Center', '(049) 501-1234', 'Medical'),
('hot7', 'Meralco', '16211', 'Utility'),
('hot8', 'Water District', '0967-890-1234', 'Utility'),
('hot9', 'DOH Hotline', '1555', 'Health'),
('hot10', 'Women & Children Desk', '0978-901-2345', 'Social Services');
=======
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
>>>>>>> a7738a224d24ec3d09bed887c49f960150f89ea5
