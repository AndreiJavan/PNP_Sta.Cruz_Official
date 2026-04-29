export const mockHotlines = [];

export const mockBulletins = [];

export const mockUsers = [
  {
    id: 'superadmin',
    username: 'superadmin',
    email: 'superadmin@example.com',
    full_name: 'Super Administrator',
    password_hash: '$2a$10$DMpQH4fGsPrzMYMTWe/pIeOUF2eID.ay62ZxVAkvsF24VjNgO5h3y', // 'admin123' hashed
    role: 'superadmin',
    created_at: new Date().toISOString()
  }
];

export const mockTips = [];

export const mockAuditLogs = [];

export const mockMapPoints = [
  // Alipit
  { id: 'm1', barangay: 'Alipit', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.223931, lng: 121.405213, description: 'Sample Theft report' },
  { id: 'm2', barangay: 'Alipit', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.224931, lng: 121.406213, description: 'Sample Vandalism report' },
  // Bagumbayan
  { id: 'm3', barangay: 'Bagumbayan', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.268334, lng: 121.398454, description: 'Sample Assault report' },
  { id: 'm4', barangay: 'Bagumbayan', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.269334, lng: 121.399454, description: 'Sample Robbery report' },
  // Bubukal
  { id: 'm5', barangay: 'Bubukal', incident_type: 'Suspicious Activity', incident_date: new Date().toISOString(), lat: 14.256460, lng: 121.399183, description: 'Sample Suspicious Activity report' },
  { id: 'm6', barangay: 'Bubukal', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.257460, lng: 121.400183, description: 'Sample Theft report' },
  // Calios
  { id: 'm7', barangay: 'Calios', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.2750, lng: 121.4050, description: 'Sample Vandalism report' },
  // Duhat
  { id: 'm8', barangay: 'Duhat', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.2525, lng: 121.3825, description: 'Sample Assault report' },
  // Gatid
  { id: 'm9', barangay: 'Gatid', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.2600, lng: 121.3830, description: 'Sample Robbery report' },
  // Jasaan
  { id: 'm10', barangay: 'Jasaan', incident_type: 'Suspicious Activity', incident_date: new Date().toISOString(), lat: 14.223577, lng: 121.394827, description: 'Sample Suspicious Activity report' },
  // Labuin
  { id: 'm11', barangay: 'Labuin', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.250158, lng: 121.400664, description: 'Sample Theft report' },
  // Malinao
  { id: 'm12', barangay: 'Malinao', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.232833, lng: 121.396823, description: 'Sample Vandalism report' },
  // Oogong
  { id: 'm13', barangay: 'Oogong', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.226323, lng: 121.400621, description: 'Sample Assault report' },
  // Pagsawitan
  { id: 'm14', barangay: 'Pagsawitan', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.265754, lng: 121.426545, description: 'Sample Robbery report' },
  // Palasan
  { id: 'm15', barangay: 'Palasan', incident_type: 'Suspicious Activity', incident_date: new Date().toISOString(), lat: 14.257498, lng: 121.418992, description: 'Sample Suspicious Activity report' },
  // Patimbao
  { id: 'm16', barangay: 'Patimbao', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.270081, lng: 121.418366, description: 'Sample Theft report' },
  // Poblacion I
  { id: 'm17', barangay: 'Poblacion I (Barangay I)', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.277068, lng: 121.418881, description: 'Sample Vandalism report' },
  // Poblacion II
  { id: 'm18', barangay: 'Poblacion II (Barangay II)', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.279647, lng: 121.416006, description: 'Sample Assault report' },
  // Poblacion III
  { id: 'm19', barangay: 'Poblacion III (Barangay III)', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.282028, lng: 121.415159, description: 'Sample Robbery report' },
  // Poblacion IV
  { id: 'm20', barangay: 'Poblacion IV (Barangay IV)', incident_type: 'Suspicious Activity', incident_date: new Date().toISOString(), lat: 14.283790, lng: 121.414016, description: 'Sample Suspicious Activity report' },
  // Poblacion V
  { id: 'm21', barangay: 'Poblacion V (Barangay V)', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.285282, lng: 121.412476, description: 'Sample Theft report' },
  // San Jose
  { id: 'm22', barangay: 'San Jose', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.237118, lng: 121.403754, description: 'Sample Vandalism report' },
  // San Juan
  { id: 'm23', barangay: 'San Juan', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.243815, lng: 121.406972, description: 'Sample Assault report' },
  // San Pablo Norte
  { id: 'm24', barangay: 'San Pablo Norte', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.290210, lng: 121.413023, description: 'Sample Robbery report' },
  // San Pablo Sur
  { id: 'm25', barangay: 'San Pablo Sur', incident_type: 'Suspicious Activity', incident_date: new Date().toISOString(), lat: 14.282211, lng: 121.422261, description: 'Sample Suspicious Activity report' },
  // Santisima Cruz
  { id: 'm26', barangay: 'Santisima Cruz', incident_type: 'Theft', incident_date: new Date().toISOString(), lat: 14.290647, lng: 121.409140, description: 'Sample Theft report' },
  // Santo Angel Central
  { id: 'm27', barangay: 'Santo Angel Central', incident_type: 'Vandalism', incident_date: new Date().toISOString(), lat: 14.285137, lng: 121.408947, description: 'Sample Vandalism report' },
  // Santo Angel Norte
  { id: 'm28', barangay: 'Santo Angel Norte', incident_type: 'Assault', incident_date: new Date().toISOString(), lat: 14.288547, lng: 121.406307, description: 'Sample Assault report' },
  // Santo Angel Sur
  { id: 'm29', barangay: 'Santo Angel Sur', incident_type: 'Robbery', incident_date: new Date().toISOString(), lat: 14.282329, lng: 121.410985, description: 'Sample Robbery report' }
];

export const mockIntelligenceScans = [];

export const mockAdminNotifications = [];

