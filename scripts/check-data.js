const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'finger!@#', database: 'oci_crm'
  });

  const [a] = await c.query("SELECT COUNT(*) cnt, IFNULL(SUM(expected_amount),0) amt FROM leads WHERE stage='won' AND YEAR(updated_at)=2026");
  console.log('2026 수주 (대시보드 현재년도):', a[0]);

  const [b] = await c.query("SELECT COUNT(*) cnt, IFNULL(SUM(expected_amount),0) amt FROM leads WHERE stage='won' AND YEAR(updated_at)=2025");
  console.log('2025 수주:', b[0]);

  const [d] = await c.query('SELECT stage, COUNT(*) cnt FROM leads GROUP BY stage ORDER BY cnt DESC');
  console.log('스테이지 현황:', d);

  const [m] = await c.query("SELECT DATE_FORMAT(created_at,'%Y-%m') ym, COUNT(*) cnt FROM leads WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) GROUP BY ym ORDER BY ym");
  console.log('최근 6개월 신규 리드 (대시보드 월별차트):', m);

  const [allmon] = await c.query("SELECT DATE_FORMAT(created_at,'%Y-%m') ym, COUNT(*) cnt FROM leads GROUP BY ym ORDER BY ym");
  console.log('전체 월별 리드 분포:', allmon);

  const [proj] = await c.query("SELECT COUNT(*) cnt FROM projects WHERE YEAR(created_at)=2025");
  console.log('2025 프로젝트:', proj[0]);

  const [cal] = await c.query("SELECT YEAR(start_time) yr, COUNT(*) cnt FROM calendar_events GROUP BY yr ORDER BY yr");
  console.log('캘린더 연도별:', cal);

  await c.end();
})().catch(e => console.error(e));
