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
