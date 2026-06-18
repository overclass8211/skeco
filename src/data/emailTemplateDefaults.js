'use strict';
// =============================================================
// 이메일 템플릿 기본 시드 — initTables.js 가 사용
//
// 변수 치환 (클라이언트에서 처리):
//   {{customer_name}}    — 고객사명
//   {{contact_person}}   — 고객사 담당자
//   {{project_name}}     — 프로젝트명
//   {{my_name}}          — 로그인 사용자 (team_members.name)
//   {{my_company}}       — 회사명 (system_settings.company_name, fallback "OCI")
//   {{today}}            — 오늘 (YYYY-MM-DD)
//   {{bidding_deadline}} — 입찰 마감일 (리드 컨텍스트)
// =============================================================

const DEFAULT_EMAIL_TEMPLATES = [
  {
    name: '첫 미팅 요청',
    category: 'lead',
    subject: '[{{my_company}}] {{customer_name}} 미팅 요청드립니다',
    body: [
      '{{contact_person}}님 안녕하세요,',
      '',
      '{{my_company}}의 {{my_name}}입니다.',
      '',
      '{{customer_name}}의 {{project_name}} 관련하여 협력 가능성을 논의드리고자',
      '간단한 미팅을 요청드립니다.',
      '',
      '편하신 일정을 회신 주시면 일정 조율 부탁드리겠습니다.',
      '',
      '감사합니다.',
      '',
      '{{my_name}} 드림',
      '{{today}}',
    ].join('\n'),
  },
  {
    name: '견적서 발송',
    category: 'lead',
    subject: '[{{my_company}}] {{project_name}} 견적서 발송',
    body: [
      '{{contact_person}}님 안녕하세요,',
      '',
      '{{my_company}}의 {{my_name}}입니다.',
      '',
      '요청 주신 {{project_name}} 견적서를 송부드립니다.',
      '※ 견적서 파일은 별도 첨부하여 전달드립니다.',
      '',
      '내용 확인 후 추가 문의사항이 있으시면 언제든 연락 부탁드립니다.',
      '',
      '검토 후 회신 기다리겠습니다.',
      '',
      '감사합니다.',
      '',
      '{{my_name}} 드림',
    ].join('\n'),
  },
  {
    name: '미팅 follow-up',
    category: 'general',
    subject: '[{{my_company}}] 금일 미팅 감사드립니다',
    body: [
      '{{contact_person}}님,',
      '',
      '오늘 시간 내어 미팅에 참석해 주셔서 진심으로 감사드립니다.',
      '',
      '논의된 내용은 내부 검토 후 회신 드리겠으며,',
      '추가로 필요하신 자료가 있으시면 편하게 연락 부탁드립니다.',
      '',
      '다시 한 번 감사드립니다.',
      '',
      '{{my_name}} 드림',
      '{{my_company}}',
    ].join('\n'),
  },
  {
    name: '입찰 마감 안내',
    category: 'lead',
    subject: '[알림] {{project_name}} 입찰 마감일 안내 ({{bidding_deadline}})',
    body: [
      '{{contact_person}}님,',
      '',
      '{{project_name}} 입찰 마감일이 {{bidding_deadline}}로 다가오고 있어 안내드립니다.',
      '',
      '제출 서류 준비 및 일정 협의가 필요하시면 사전에 회신 부탁드립니다.',
      '저희 측에서도 차질 없이 준비할 수 있도록 협력하겠습니다.',
      '',
      '감사합니다.',
      '',
      '{{my_name}} 드림',
      '{{my_company}}',
    ].join('\n'),
  },
  {
    name: '수주 감사 인사',
    category: 'project',
    subject: '[{{my_company}}] {{project_name}} 계약 체결에 깊이 감사드립니다',
    body: [
      '{{contact_person}}님,',
      '',
      '{{project_name}} 사업에 {{my_company}}을(를) 선정해 주셔서',
      '깊이 감사드립니다.',
      '',
      '계약 내용대로 최선을 다해 진행하겠으며,',
      '진행 단계마다 결과를 공유드리도록 하겠습니다.',
      '',
      '함께 좋은 결과를 만들어 가겠습니다.',
      '',
      '{{my_name}} 드림',
      '{{my_company}}',
    ].join('\n'),
  },
];

module.exports = { DEFAULT_EMAIL_TEMPLATES };
