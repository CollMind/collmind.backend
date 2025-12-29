-- Create main schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS main;

-- Grant privileges to postgres user
GRANT ALL PRIVILEGES ON SCHEMA main TO postgres;

