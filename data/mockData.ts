export const mockPublicUsers: any[] = [];

export const mockHotlines = [
  { id: '1', name: 'PNP Sta. Cruz', number: '0998 598 5667', category: 'Police' },
  { id: '2', name: 'BFP Sta. Cruz', number: '0923-456-7890', category: 'Fire' },
  { id: '3', name: 'Sta. Cruz Rescue', number: '0934-567-8901', category: 'Emergency' },
  { id: '4', name: 'MDRRMO', number: '0945-678-9012', category: 'Disaster' },
  { id: '5', name: 'Red Cross Laguna', number: '0956-789-0123', category: 'Medical' }
];

export const mockBulletins = [
  {
    id: 'bul1',
    title: 'Missing Person: Juan Dela Cruz',
    category: 'Missing Person',
    body: 'Last seen wearing a blue shirt near the plaza.',
    photo_path: 'https://picsum.photos/seed/pnp-missing-person/800/600',
    is_archived: false,
    posted_by: 'superadmin',
    created_at: new Date().toISOString()
  },
  {
    id: 'bul2',
    title: 'Crime Advisory: Night Patrols',
    category: 'Crime Advisory',
    body: 'Increased police presence in residential areas.',
    photo_path: 'https://picsum.photos/seed/pnp-night-patrol/800/600',
    is_archived: false,
    posted_by: 'superadmin',
    created_at: new Date().toISOString()
  }
];

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

export const mockTips = [
  {
    id: 'tip1',
    tip_id: 'TIP-8492',
    concern_type: 'Suspicious Activity',
    location_text: 'Public Market Area',
    description: 'Noticeable group of individuals loitering around the warehouse entrance during curfew hours.',
    is_flagged: true,
    admin_notes: 'Patrol dispatched. Area under surveillance.',
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'tip2',
    tip_id: 'TIP-2041',
    concern_type: 'Illegal Gambling',
    location_text: 'Brgy. Bagumbayan',
    description: 'Reports of nightly tupada sessions behind the old mill.',
    is_flagged: false,
    admin_notes: '',
    created_at: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'tip3',
    tip_id: 'TIP-9932',
    concern_type: 'Drug Related',
    location_text: 'Poblacion IV',
    description: 'Frequent short-term visitors to a house near the chapel at odd hours.',
    is_flagged: true,
    admin_notes: 'Forwarded to PDEA/Investigation unit.',
    created_at: new Date(Date.now() - 172800000).toISOString()
  }
];

export const mockAuditLogs = [
  {
    id: 'log1',
    admin_id: 'superadmin',
    username: 'superadmin',
    action: 'Logged in',
    details: 'Admin logged into the system',
    timestamp: new Date().toISOString()
  }
];

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

export const mockIntelligenceScans = [
  {
    id: 'scan1',
    admin_id: 'superadmin',
    admin_name: 'Super Administrator',
    timestamp: new Date().toISOString(),
    total_records: 3,
    category_stats: {
      '8-Focus': 1,
      'PSI': 1,
      'Non-Index': 1
    },
    raw_data: [
      { barangay: 'Alipit', incident_date: '2026-01-08', offense: 'Theft', category: '8-Focus', description: 'Intel extracted' },
      { barangay: 'Bubukal', incident_date: '2026-01-15', offense: 'Vehicular Accident', category: 'PSI', description: 'Intel extracted' },
      { barangay: 'Labuin', incident_date: '2026-01-20', offense: 'Illegal Gambling', category: 'Non-Index', description: 'Intel extracted' }
    ]
  }
];

export const mockAdminNotifications = [
  {
    id: 'not1',
    title: 'High Alert: Severe Incident Grouping',
    message: 'Multiple severe incidents reported in Brgy. Bagumbayan within the last 24 hours.',
    is_read: false,
    created_at: new Date().toISOString()
  }
];
