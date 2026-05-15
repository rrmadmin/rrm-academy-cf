-- Migration 022d: DROP stale practitioner table (D27)
-- Runs LAST, after all additive steps complete + verified.
-- Backup at migrations/backups/practitioner-pre-drop-2026-05-14.sql (Task 3).

DROP TABLE IF EXISTS practitioner;
