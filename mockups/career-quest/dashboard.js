// All integration and review state is session-local demo state, never credentials.
const demoConnections = new Map();
const discussedSignals = new Set();
let tablePage = 0;
let showAllInsights = false;
let connectionDraft = null;
let toastTimer;
const PAGE_SIZE = 10;
const sourceLabel = source => source === 'github' ? 'GitHub' : 'Jira';

function employeeSummary(employee) {
  const profile=nextProfile(employee), levels=effectiveSkills(employee), gaps=getGaps(profile,levels);
  const total=gaps.reduce((n,g)=>n+g.required,0);
  return {profile,levels,gaps,readiness:total?Math.round(gaps.reduce((n,g)=>n+Math.min(g.current,g.required),0)/total*100):100};
}

function demoTemplate(employee) { return MOCK_INTEGRATIONS.templates[employee.role] || MOCK_INTEGRATIONS.fallback; }
function sourceResources(employee,source) {
  const template=demoTemplate(employee);
  return source==='github'?[template.repo,template.repo+'-docs']:[template.project,template.project+'-PRACTICE'];
}
function connectDemo(employee,source,resources) {
  const current=demoConnections.get(employee.employee_id)||{};
  current[source]={resources:[...resources],syncedAt:'30.09.2026, 18:00 · демо-срез'};
  demoConnections.set(employee.employee_id,current);
  discussedSignals.delete(employee.employee_id);
}

function evidenceFor(employee) {
  const connections=demoConnections.get(employee.employee_id)||{};
  const template=demoTemplate(employee);
  return ['github','jira'].flatMap(source=>{
    const connection=connections[source];
    if(!connection)return [];
    return connection.resources.flatMap((resource,r)=>template[source].map((note,i)=>({
      source,resource,skill:template.skill,title:template.title,note,date:`2026-09-${String(12+r*5+i*3).padStart(2,'0')}`,
      id:source==='github'?`PR #${120+Number(employee.employee_id.slice(1))*3+r*2+i}`:`${resource}-${200+Number(employee.employee_id.slice(1))*3+r*2+i}`
    })));
  });
}

function signalFor(employee) {
  const evidence=evidenceFor(employee);
  if(!evidence.length)return null;
  const template=demoTemplate(employee), summary=employeeSummary(employee);
  const gap=summary.gaps.find(g=>g.id===template.skill);
  const sufficient=evidence.length>=2;
  const skill=db.skillById.get(template.skill)?.name||template.skill;
  return {employee,evidence,summary,gap,skill,sufficient,template,
    title:!sufficient?'Недостаточно данных для вывода':gap?.gap>0?`Возможная зона роста: ${skill}`:`Стоит уточнить практику: ${skill}`,
    explanation:!sufficient?'Один эпизод не позволяет оценить навык. Нужны другие примеры и разговор с сотрудником.':gap?.gap>0?`Замечания в демо-источниках совпадают с разрывом в матрице: ${gap.current} из ${gap.required} для ${summary.profile.grade}. Это повод обсудить развитие, не доказательство дефицита.`:'Есть замечания к отдельным рабочим эпизодам. Они не доказывают пробел в навыке и не меняют оценку в профиле.'};
}

function renderDashboardExtras(people) {
  renderSupportOverview(people);
  const github=people.filter(e=>demoConnections.get(e.employee_id)?.github).length;
  const jira=people.filter(e=>demoConnections.get(e.employee_id)?.jira).length;
  const any=people.filter(e=>Object.keys(demoConnections.get(e.employee_id)||{}).length).length;
  $('source-coverage').textContent=`GitHub: ${github} / ${people.length} · Jira: ${jira} / ${people.length} · Без подключений: ${people.length-any}. Все подключения демонстрационные.`;
  const signals=people.map(signalFor).filter(Boolean);
  $('insight-count').textContent=`${signals.length} сотрудников с демо-сигналами`;
  $('insights-list').innerHTML=(showAllInsights?signals:signals.slice(0,6)).map(signal=>{
    const reviewed=discussedSignals.has(signal.employee.employee_id);
    const sources=[...new Set(signal.evidence.map(e=>sourceLabel(e.source)))];
    return `<article class="insight-card"><div class="insight-meta"><span class="source-badge">${sources.join(' + ')}</span><span class="review-status ${reviewed?'reviewed':''}">${reviewed?'К обсуждению':signal.sufficient?'Проверить гипотезу':'Мало данных'}</span></div><h4>${escapeHtml(signal.title)}</h4><p class="insight-person">${escapeHtml(signal.employee.full_name)} · ${escapeHtml(signal.employee.role)}</p><p>${escapeHtml(signal.explanation)}</p><button class="text-button" data-signal="${signal.employee.employee_id}">Разобрать ${signal.evidence.length} демо-примера →</button></article>`;
  }).join('')||'<p class="empty-state">В этой выборке нет подключённых демо-источников. Это не означает, что у сотрудников нет навыков. Подключения можно добавить в соответствующем разделе.</p>';
  $('show-insights').hidden=signals.length<=6;
  $('show-insights').textContent=showAllInsights?'Свернуть сигналы':`Показать все сигналы (${signals.length})`;
  renderEmployeeTable(people);
}

function filteredPeople() {
  return scopedEmployees().filter(e=>($('role-select').value==='all'||e.role===$('role-select').value)&&($('department-select').value==='all'||e.department===$('department-select').value));
}

function renderEmployeeTable(people=filteredPeople()) {
  if(workspaceRole==='employee')return;
  renderSupportTable(people);
}

function renderSignalDetail(id) {
  const signal=signalFor(db.employeeById.get(id));
  if(!signal)return;
  const {employee,summary}=signal;
  const rec=signal.sufficient?recommendations(employee,summary.profile,summary.levels,summary.gaps).find(r=>r.effects.some(e=>e.name===signal.skill)):null;
  $('detail-title').textContent=employee.full_name;
  $('detail-content').innerHTML=`<p class="dialog-subtitle">${escapeHtml(employee.role)} · ${employee.grade} <span class="demo-tag">ДЕМО-АНАЛИЗ</span></p><h3>${escapeHtml(signal.title)}</h3><p>${escapeHtml(signal.explanation)}</p><div class="evidence-summary">Период: ${MOCK_INTEGRATIONS.period} · ${signal.evidence.length} рабочих эпизода · ${new Set(signal.evidence.map(e=>e.source)).size} источника</div><h3>На чём основан вывод</h3><div class="evidence-list">${signal.evidence.map(e=>`<article class="evidence-card"><div><span class="source-badge">${sourceLabel(e.source)}</span><span class="muted">${dateRu(e.date)}</span></div><h4>${escapeHtml(e.id)} · ${escapeHtml(e.title)}</h4><p>${escapeHtml(e.note)}</p><small>${escapeHtml(e.resource)} · вымышленный пример</small></article>`).join('')}</div><div class="suggested-step"><p class="section-kicker">ПРЕДЛОЖЕННЫЙ ШАГ</p><h3>${!signal.sufficient?'Собрать больше контекста':rec?escapeHtml(rec.event.title):'Практика с наставником'}</h3><p>${!signal.sufficient?'Обсудить рабочий эпизод с сотрудником, учесть сложность задачи и получить дополнительные примеры.':rec?`Активность из настоящего каталога: ${rec.event.duration_hours} ч · ${escapeHtml(rec.session)}. ${escapeHtml(signal.skill)}: ${rec.effects.find(e=>e.name===signal.skill).before} → ${rec.effects.find(e=>e.name===signal.skill).after} после завершения.`:escapeHtml(signal.template.practice)+' Это предложение, не мероприятие из каталога.'}</p></div><p class="muted">Количество PR, сроки задач и отсутствие активности не используются как оценка компетентности. Замечания могут зависеть от сложности задачи и контекста команды. Требуется обсуждение с сотрудником.</p><button class="primary-button" data-discuss="${id}" ${discussedSignals.has(id)?'disabled':''}>${discussedSignals.has(id)?'Отмечено к обсуждению':'Отметить к обсуждению · демо'}</button><p class="muted">Локальная отметка для HR. Ничего не отправляет и не меняет профиль.</p>`;
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}

function renderIntegrations() {
  if(workspaceRole!=='employee')return;
  const employee=db.employeeById.get(actorId);
  if(!employee)return;
  const current=demoConnections.get(employee.employee_id)||{};
  $('integration-cards').innerHTML=['github','jira'].map(source=>{
    const connection=current[source], records=evidenceFor(employee).filter(e=>e.source===source);
    return `<article class="panel integration-card"><div class="panel-head"><div class="provider-title"><span class="provider-icon ${source}">${source==='github'?'GH':'J'}</span><h3>${sourceLabel(source)}</h3></div><span class="review-status ${connection?'reviewed':''}">${connection?'Демо подключено':'Не подключено'}</span></div><p>${source==='github'?'Репозитории, pull requests и замечания к коду.':'Задачи, критерии готовности и обсуждения работы.'}</p>${connection?`<div class="connection-detail"><b>Демо-аккаунт: ${employee.employee_id.toLowerCase()}</b><p>${connection.resources.map(escapeHtml).join('<br>')}</p><small>Загружено примеров: ${records.length}<br>Срез: ${escapeHtml(connection.syncedAt)}</small></div><div class="button-row"><button class="primary-button" data-sync="${source}">Обновить демо-данные</button><button class="secondary-button" data-disconnect="${source}">Отключить</button></div>`:`<div class="connection-detail"><p>Доступ только на чтение. Сотрудник выбирает, какие источники можно анализировать.</p></div><button class="primary-button" data-connect="${source}">Подключить ${sourceLabel(source)} · демо</button>`}</article>`;
  }).join('');
}

function showConnect(source) {
  if(workspaceRole!=='employee'||!['github','jira'].includes(source))return;
  const employee=db.employeeById.get(actorId);
  connectionDraft={employeeId:employee.employee_id,source};
  $('connect-form').reset();
  $('connect-title').textContent=`Подключение ${sourceLabel(source)} · демо`;
  $('connect-person').textContent=`Сотрудник: ${employee.full_name}. Доступ только на чтение.`;
  $('resource-choices').innerHTML=sourceResources(employee,source).map((resource,i)=>`<label class="resource-choice"><input type="checkbox" name="resource" value="${escapeHtml(resource)}" ${i===0?'checked':''} /> ${escapeHtml(resource)}</label>`).join('');
  $('connect-dialog').showModal();
}

function toast(message) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,4500);
}

function initDashboard() {
  MOCK_INTEGRATIONS.seeds.forEach((id,index)=>{
    const employee=db.employeeById.get(id);if(!employee)return;
    connectDemo(employee,'jira',sourceResources(employee,'jira').slice(0,1));
    if(/Engineer|Analyst/.test(employee.role)&&index%4!==0)connectDemo(employee,'github',sourceResources(employee,'github').slice(0,1));
  });
  $('department-select').innerHTML='<option value="all">Все отделы</option>'+[...new Set(db.employees.map(e=>e.department))].sort().map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  $('integration-employee').innerHTML=$('employee-select').innerHTML;
  $('integration-employee').value='E0028';
  $('department-select').addEventListener('change',()=>{tablePage=0;renderHr($('role-select').value);});
  $('employee-search').addEventListener('input',()=>{tablePage=0;renderEmployeeTable();});
  $('previous-page').addEventListener('click',()=>{tablePage--;renderEmployeeTable();});
  $('next-page').addEventListener('click',()=>{tablePage++;renderEmployeeTable();});
  $('show-insights').addEventListener('click',()=>{showAllInsights=!showAllInsights;renderDashboardExtras(filteredPeople());});
  $('integration-employee').addEventListener('change',renderIntegrations);
  $('connect-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(workspaceRole!=='employee'||connectionDraft?.employeeId!==actorId)return;
    const resources=[...document.querySelectorAll('input[name="resource"]:checked')].map(input=>input.value);
    if(!resources.length){toast('Выберите хотя бы один демо-источник.');return;}
    if(!$('connect-consent').checked)return;
    const employee=db.employeeById.get(connectionDraft.employeeId);
    connectDemo(employee,connectionDraft.source,resources);
    $('connect-dialog').close();renderIntegrations();toast('Демо-источник подключён. Сигнал появился в общей сводке HR.');
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.go)switchView(button.dataset.go);
    if(button.dataset.close)$(button.dataset.close).close();
    if(button.dataset.profile)openEmployeeCard(button.dataset.profile);
    if(button.dataset.signal)showSignal(button.dataset.signal);
    if(button.dataset.discuss&&canReviewEmployee(button.dataset.discuss)){discussedSignals.add(button.dataset.discuss);renderHr($('role-select').value);showSignal(button.dataset.discuss);toast('Отмечено к обсуждению. Уведомления не отправлялись.');}
    if(button.dataset.connect)showConnect(button.dataset.connect);
    if(button.dataset.sync&&workspaceRole==='employee'){const current=demoConnections.get(actorId);current[button.dataset.sync].syncedAt='30.09.2026, 18:00 · повторно загружен тот же демо-срез';renderIntegrations();toast('Демо-срез обновлён. Дубликаты не добавлены.');}
    if(button.dataset.disconnect&&workspaceRole==='employee'){delete demoConnections.get(actorId)[button.dataset.disconnect];discussedSignals.delete(actorId);renderIntegrations();toast('Демо-источник отключён. Его примеры удалены из анализа HR.');}
  });
}
