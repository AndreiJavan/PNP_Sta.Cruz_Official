# Sta. Cruz Crime Mapping & Reporting System (CPICRS)

This is a specialized crime visualization and incident reporting platform for PNP Sta. Cruz, Laguna.

## Prerequisites

- **Node.js**: v24.15.0 or higher is recommended.
- **npm**: Included with Node.js.

## Local Setup

1. **Clone the repository** (if applicable).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in the required values.
   ```bash
   cp .env.example .env
   ```
   - `SESSION_SECRET`: A random string for session encryption.
   - `GEMINI_API_KEY`: (Optional) For AI-powered features.
   - `MAPBOX_ACCESS_TOKEN`: (Optional) For Mapbox visualization.

4. **Run the application**:
   
   **Development mode** (with auto-reload):
   ```bash
   npm run dev
   ```
   
   **Standard mode**:
   ```bash
   npm start
   ```

The application will be available at `http://localhost:3000`.

## Scripts

- `npm run dev`: Runs the app using `tsx` for TypeScript execution.
- `npm start`: Runs the app in production-like mode.
- `npm run build`: Placeholder for build steps (currently no compilation required as Node 24 supports TS natively or via `tsx`).
- `npm run lint`: Checks for TypeScript errors.

## Tech Stack

- **Backend**: Node.js, Express
- **View Engine**: EJS (Embedded JavaScript)
- **Styling**: Tailwind CSS
- **Database**: Mock Data Service (ready for local development)
