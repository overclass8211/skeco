USE oci_crm;

-- 11월~4월에 자연스럽게 분포 (id 기준 순환)
UPDATE leads
SET created_at = DATE_SUB(NOW(), INTERVAL (id % 6) MONTH) - INTERVAL FLOOR(RAND()*28) DAY,
    updated_at = created_at;

-- 단계별 자연스러운 분포 보정
-- (이미 수주된 건은 더 과거로, 진행중은 최근으로)
UPDATE leads SET created_at = DATE_SUB(NOW(), INTERVAL 5 MONTH) - INTERVAL 3 DAY 
  WHERE id IN (1, 2);
UPDATE leads SET created_at = DATE_SUB(NOW(), INTERVAL 4 MONTH) - INTERVAL 10 DAY 
  WHERE id IN (3, 4, 5);
UPDATE leads SET created_at = DATE_SUB(NOW(), INTERVAL 3 MONTH) - INTERVAL 5 DAY 
  WHERE id IN (6, 7);
UPDATE leads SET created_at = DATE_SUB(NOW(), INTERVAL 2 MONTH) - INTERVAL 12 DAY 
  WHERE id IN (8, 9, 10);
UPDATE leads SET created_at = DATE_SUB(NOW(), INTERVAL 1 MONTH) - INTERVAL 8 DAY 
  WHERE id IN (11, 12);
-- 13, 14, 15는 그대로 이번달