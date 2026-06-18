USE oci_crm;

ALTER TABLE activities 
MODIFY COLUMN activity_type VARCHAR(50) DEFAULT 'note';