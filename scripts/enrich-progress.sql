-- Course progress enrichment — generated 2026-02-26T18:22:33.874Z
-- Updates enrollment records with completed_at and certificate_issued_at

-- john.crystal.miller (Finished, 100%)
UPDATE enrollment SET completed_at = '2026-01-29', certificate_issued_at = '2026-01-29' WHERE user_id = (SELECT id FROM user WHERE email = 'john.crystal.miller@gmail.com') AND course_id = 'masterclass-endo-surgery';

-- Emily Golding (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-10-18', certificate_issued_at = '2025-10-18' WHERE user_id = (SELECT id FROM user WHERE email = 'emilysgolding@gmail.com') AND course_id = 'masterclass-endo-surgery';

-- Maggie McCarthy (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-08-28', certificate_issued_at = '2025-08-28' WHERE user_id = (SELECT id FROM user WHERE email = 'maggievdb@gmail.com') AND course_id = 'masterclass-endo-surgery';

-- amy.galvan (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-06-28', certificate_issued_at = '2025-06-28' WHERE user_id = (SELECT id FROM user WHERE email = 'amy.galvan@agaom.com') AND course_id = 'masterclass-endo-surgery';

-- farrytalefamily (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-05-28', certificate_issued_at = '2025-05-28' WHERE user_id = (SELECT id FROM user WHERE email = 'farrytalefamily@gmail.com') AND course_id = 'masterclass-endo-surgery';

-- emily.davis78 (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-03-27', certificate_issued_at = '2025-03-27' WHERE user_id = (SELECT id FROM user WHERE email = 'emily.davis78@yahoo.com') AND course_id = 'masterclass-endo-surgery';

-- Kelly Martin (Finished, 100%)
UPDATE enrollment SET completed_at = '2024-08-15', certificate_issued_at = '2024-08-15' WHERE user_id = (SELECT id FROM user WHERE email = 'kellycm@protonmail.com') AND course_id = 'masterclass-endo-surgery';

-- Zachary Sluzala (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-10-22' WHERE user_id = (SELECT id FROM user WHERE email = 'zsluzala@lozierinstitute.org') AND course_id = 'long-term-endo-management';

-- swinsley1 (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-09-22' WHERE user_id = (SELECT id FROM user WHERE email = 'swinsley1@gmail.com') AND course_id = 'long-term-endo-management';

-- Ashley Nickerson (Finished, 100%)
UPDATE enrollment SET completed_at = '2025-06-20' WHERE user_id = (SELECT id FROM user WHERE email = 'ashley@nourishgreenville.com') AND course_id = 'long-term-endo-management';

