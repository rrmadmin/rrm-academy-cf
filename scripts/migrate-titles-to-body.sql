UPDATE community_post
SET content = CASE
  WHEN title IS NOT NULL AND title <> '' AND body IS NOT NULL AND body <> ''
    THEN title || char(10) || char(10) || body
  WHEN title IS NOT NULL AND title <> ''
    THEN title
  ELSE body
END;
