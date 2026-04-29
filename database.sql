-- CPICRS Database Dump (MySQL 8.0 Compatible)
-- Generated for PNP Sta. Cruz, Laguna

CREATE DATABASE IF NOT EXISTS cpicrs;
USE cpicrs;

-- Table: users
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('superadmin', 'staff') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: incident_reports
CREATE TABLE incident_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
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
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category ENUM('Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement') NOT NULL,
  body TEXT NOT NULL,
  photo_path VARCHAR(255),
  is_archived TINYINT(1) DEFAULT 0,
  posted_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

-- Table: anonymous_tips
CREATE TABLE anonymous_tips (
  id INT AUTO_INCREMENT PRIMARY KEY,
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
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  incident_type VARCHAR(50) NOT NULL,
  incident_date DATETIME NOT NULL,
  FOREIGN KEY (report_id) REFERENCES incident_reports(id)
);

-- Table: hotlines
CREATE TABLE hotlines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  number VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: audit_logs
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT,
  action TEXT NOT NULL,
  target_table VARCHAR(50) NOT NULL,
  target_id INT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

-- Table: intelligence_scans
CREATE TABLE intelligence_scans (
  id VARCHAR(50) PRIMARY KEY,
  admin_id VARCHAR(50) NOT NULL,
  admin_name VARCHAR(100) NOT NULL,
  total_records INT NOT NULL,
  category_stats JSON,
  raw_data JSON,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: admin_notifications
CREATE TABLE admin_notifications (
  id VARCHAR(50) PRIMARY KEY,
  message TEXT NOT NULL,
  type ENUM('tip', 'system', 'alert') DEFAULT 'system',
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data
INSERT INTO users (username, full_name, password_hash, role) VALUES 
('superadmin', 'Super Administrator', '$2a$10$7v6E8Z9R9R9R9R9R9R9R9O', 'superadmin'),
('staff', 'PNP Staff Member', '$2a$10$7v6E8Z9R9R9R9R9R9R9R9O', 'staff');
-- (Note: Password hashes are placeholders, use bcrypt to generate real ones)

INSERT INTO hotlines (name, number, category) VALUES 
('PNP Sta. Cruz', '+63998-598-5667', 'Police'),
('BFP Sta. Cruz', '+63967-052-8897', 'Fire'),
('MDRRMO Sta. Cruz', '+63921-962-0602', 'Disaster'),
('Red Cross', '+63 2 8790 2300', 'Medical');
