// Presentation-only roles over synthetic data. Not an authorization boundary.
let workspaceRole='hr';
let actorId='E0028';
let priorityFilter='all';
const roleActors={employee:'E0028',manager:'E0050'};
const PRIORITIES={high:{label:'Высокий',rank:0},medium:{label:'Средний',rank:1},planned:{label:'Плановый',rank:2}};

function scopedEmployees(role=workspaceRole,id=actorId) {
  if(role==='hr')return db.employees;
  const actor=db.employeeById.get(id);
  if(!actor)return [];
  if(role==='employee')return [actor];
  if(role==='manager'&&db.employees.some(e=>e.manager_id===id))return db.employees.filter(e=>e.department===actor.department);
  return [];
}

function canReviewEmployee(id) {
  return workspaceRole!=='employee'&&scopedEmployees().some(e=>e.employee_id===id);
}

function latestLearning(employee) {
  const latest=new Map();
  for(const row of [...employeeHistory(employee)].sort((a,b)=>a.date.localeCompare(b.date)||a.record_id.localeCompare(b.record_id)))latest.set(row.event_id,row);
  return [...latest.values()];
}

function pendingLearning(employee) {
  return latestLearning(employee).filter(r=>r.status!=='completed'&&(db.eventById.get(r.event_id)?.mandatory||r.status==='in_progress'));
}

function supportPriority(employee) {
  const summary=employeeSummary(employee), gaps=summary.gaps.filter(g=>g.gap>0), critical=gaps.filter(g=>g.critical);
  const mandatory=pendingLearning(employee).filter(r=>db.eventById.get(r.event_id)?.mandatory);
  const overdue=mandatory.filter(r=>r.status==='overdue'||(r.due_date&&r.due_date<AS_OF));
  const severe=critical.filter(g=>g.gap>=2).length;
  const level=overdue.length||severe>=2?'high':critical.length||mandatory.length||summary.readiness<70?'medium':'planned';
  const reasons=[];
  if(overdue.length)reasons.push(`Обязательных занятий с истёкшим сроком: ${overdue.length}`);
  if(severe>=2)reasons.push(`Ключевых навыков с отставанием от двух уровней: ${severe}`);
  else if(critical.length)reasons.push(`Ключевых разрывов до цели: ${critical.length}`);
  if(mandatory.length&&!overdue.length)reasons.push(`Обязательных занятий к завершению: ${mandatory.length}`);
  if(summary.readiness<70)reasons.push(`Готовность к целевому профилю: ${summary.readiness}%`);
  if(!reasons.length)reasons.push(gaps.length?'Остаются некритичные разрывы до цели':'Требования целевого профиля выполнены');
  return {level,rank:PRIORITIES[level].rank,label:PRIORITIES[level].label,reasons,summary,gaps,critical,mandatory,overdue,severity:critical.reduce((n,g)=>n+g.gap,0)};
}

function compareSupport(a,b) {
  return a.priority.rank-b.priority.rank||b.priority.overdue.length-a.priority.overdue.length||b.priority.severity-a.priority.severity||a.employee.full_name.localeCompare(b.employee.full_name);
}

function renderSupportOverview(people) {
  const counts=Object.fromEntries(Object.keys(PRIORITIES).map(level=>[level,people.filter(e=>supportPriority(e).level===level).length]));
  $('support-overview').innerHTML=Object.entries(PRIORITIES).map(([level,value])=>`<button class="support-summary ${level}" data-priority-go="${level}"><span>${value.label} приоритет помощи</span><strong>${counts[level]}</strong><small>Открыть сотрудников →</small></button>`).join('');
}

function renderSupportTable(people) {
  const all=people.map(employee=>({employee,priority:supportPriority(employee)}));
  const counts=Object.fromEntries(Object.keys(PRIORITIES).map(level=>[level,all.filter(x=>x.priority.level===level).length]));
  $('priority-filters').innerHTML=[['all','Все',all.length],...Object.entries(PRIORITIES).map(([key,value])=>[key,value.label,counts[key]])].map(([key,label,count])=>`<button class="priority-filter ${key===priorityFilter?'selected':''}" data-priority="${key}" aria-pressed="${key===priorityFilter}">${label} <b>${count}</b></button>`).join('');
  const query=$('employee-search').value.trim().toLocaleLowerCase('ru');
  const matching=all.filter(({employee:e,priority:p})=>(priorityFilter==='all'||p.level===priorityFilter)&&`${e.full_name} ${e.employee_id}`.toLocaleLowerCase('ru').includes(query)).sort(compareSupport);
  const pages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
  tablePage=Math.max(0,Math.min(tablePage,pages-1));
  const start=tablePage*PAGE_SIZE, visible=matching.slice(start,start+PAGE_SIZE);
  $('employee-table-count').textContent=`· ${matching.length}`;
  let previousGroup=null;
  $('employee-table-body').innerHTML=visible.map(({employee:e,priority:p})=>{
    const group=previousGroup!==p.level?`<tr class="priority-group ${p.level}"><th colspan="6">${p.label} приоритет помощи · ${counts[p.level]} в выбранной команде</th></tr>`:'';
    previousGroup=p.level;
    const sources=Object.keys(demoConnections.get(e.employee_id)||{});
    return group+`<tr><td><b>${escapeHtml(e.full_name)}</b><small>${escapeHtml(e.role)} · ${e.grade}</small><small>${escapeHtml(e.department)} · ${e.employee_id}</small></td><td><span class="priority-badge ${p.level}">${p.label}</span><small>${escapeHtml(p.reasons[0])}</small></td><td><b>${p.summary.readiness}%</b><div class="mini-track table-progress"><div class="mini-fill" style="width:${p.summary.readiness}%"></div></div></td><td>${p.gaps.length}<small>Ключевых: ${p.critical.length}</small></td><td>${sources.length?sources.map(s=>`<span class="source-badge compact">${sourceLabel(s)}</span>`).join(' '):'<span class="muted">Не подключены</span>'}</td><td><button class="text-button" data-profile="${e.employee_id}" aria-label="Карточка: ${escapeHtml(e.full_name)}">Открыть →</button></td></tr>`;
  }).join('')||'<tr><td colspan="6" class="empty-state">Сотрудники не найдены. Измените поиск или фильтры.</td></tr>';
  $('page-summary').textContent=matching.length?`${start+1}–${Math.min(start+PAGE_SIZE,matching.length)} из ${matching.length} · По приоритету поддержки`:'Нет сотрудников';
  $('previous-page').disabled=tablePage===0;
  $('next-page').disabled=tablePage>=pages-1;
}

function sourceDigest(employee) {
  const evidence=evidenceFor(employee), template=demoTemplate(employee);
  return `<div class="source-digests">${['github','jira'].map(source=>{
    const records=evidence.filter(e=>e.source===source);
    return `<section class="source-digest"><span class="source-badge">${sourceLabel(source)}</span><h4>${records.length?source==='github'?'Изменения и доработки на ревью':'Работа с задачами':'Источник не подключён'}</h4><p>${records.length?source==='github'?`В демонстрационном сценарии сотрудник подготовил изменения по теме «${escapeHtml(template.title)}» и получил замечания на ревью.`:`В демонстрационном сценарии сотрудник работал над задачей «${escapeHtml(template.title)}» и уточнял её критерии готовности.`:'Нет выгрузки для анализа. По отсутствию подключения нельзя судить о навыках.'}</p>${records.length?`<p><b>Что стоит проверить:</b> ${escapeHtml(records[0].note)}</p><small>${records.length} ${countWord(records.length,'демо-эпизод','демо-эпизода','демо-эпизодов')} · ${MOCK_INTEGRATIONS.period}</small>`:''}</section>`;
  }).join('')}</div>`;
}

function showSignal(id) { openEmployeeCard(id); }

function openEmployeeCard(id) {
  if(!canReviewEmployee(id)){toast('Карточка недоступна в выбранном кабинете.');return;}
  const employee=db.employeeById.get(id), p=supportPriority(employee), summary=p.summary;
  const signal=signalFor(employee), manager=db.employeeById.get(employee.manager_id);
  let analysis='';
  if(signal){renderSignalDetail(id);analysis=$('detail-content').innerHTML;}
  else analysis='<div class="empty-state">ИИ-выжимки пока нет: GitHub и Jira не подключены. Ниже доступны разрывы и рекомендации из профиля и истории обучения.</div>';
  const recs=recommendations(employee,summary.profile,summary.levels,summary.gaps).slice(0,3);
  const gaps=[...p.gaps].sort((a,b)=>Number(b.critical)-Number(a.critical)||b.gap-a.gap);
  $('detail-title').textContent=`Карточка · ${employee.full_name}`;
  $('detail-content').innerHTML=`<div class="person-detail"><div><b>${escapeHtml(employee.role)} · ${employee.grade}</b><p>${escapeHtml(employee.department)} · ${employee.employee_id}</p><p>Руководитель: ${escapeHtml(manager?.full_name||'Не указан')}<br>Последняя оценка: ${dateRu(employee.last_review_date)}</p></div><div class="detail-readiness"><strong>${summary.readiness}%</strong><span>к цели ${escapeHtml(summary.profile.grade)}</span></div></div><div class="support-reasons"><span class="priority-badge ${p.level}">${p.label} приоритет помощи</span><ul>${p.reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join('')}</ul><small>Очередь поддержки по правилам прототипа, не оценка эффективности.</small></div><h3>Выжимка действий из GitHub и Jira <span class="demo-tag">МОК</span></h3><p class="muted">Вымышленные рабочие эпизоды. Шаблонный анализ, без вызова ИИ.</p>${sourceDigest(employee)}${analysis}<h3>Над чем поработать по матрице навыков</h3><div class="detail-gap-list">${gaps.map(g=>`<div><span>${escapeHtml(g.name)} ${g.critical?'<b class="key-label">ключевой</b>':''}</span><b>${g.current} → ${g.required}</b></div>`).join('')||'<p>Требования выбранной цели выполнены.</p>'}</div><h3>Ближайшее обучение для развития</h3>${recs.map(r=>`<div class="learning-row"><div><b>${escapeHtml(r.event.title)}</b><p>${r.event.duration_hours} ч · ${escapeHtml(r.session)}</p></div><span class="source-badge">${r.effects.map(e=>`${escapeHtml(e.name)} ${e.before} → ${e.after}`).join('<br>')}</span></div>`).join('')||'<p class="empty-state">В каталоге нет подходящих доступных занятий с приростом. Нужен отдельный маршрут с наставником.</p>'}<h3>Назначения к завершению</h3>${learningRows(pendingLearning(employee))}`;
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}

function learningRows(records) {
  if(!records.length)return '<p class="empty-state">Таких записей нет.</p>';
  return [...records].sort((a,b)=>b.date.localeCompare(a.date)).map(record=>{
    const event=db.eventById.get(record.event_id);
    const score=record.score!==''&&record.score!=null?` · Результат: ${escapeHtml(record.score)}/100`:'';
    return `<article class="learning-row"><div><b>${escapeHtml(event?.title||record.event_id)}</b><p>${event?.mandatory?'Обязательное':'Добровольное'} · ${dateRu(record.date)}${record.due_date?' · Срок: '+dateRu(record.due_date):''}${score}</p></div><span class="learning-status ${record.status}">${escapeHtml(STATUS_LABELS[record.status])}${record.status==='in_progress'?' · '+escapeHtml(record.completion_pct)+'%':''}</span></article>`;
  }).join('');
}

function renderPersonalProgress(employee) {
  const summary=employeeSummary(employee), history=employeeHistory(employee), completed=history.filter(r=>r.status==='completed');
  const pending=pendingLearning(employee);
  $('personal-rating').innerHTML=`<div><p class="section-kicker">МОЙ РЕЙТИНГ РАЗВИТИЯ</p><strong>${summary.readiness}<small> / 100</small></strong><p>Готовность по навыкам к моей цели. Без сравнения с коллегами.</p></div><div class="personal-stat"><b>${completed.length}</b><span>завершённых занятий</span></div><div class="personal-stat"><b>${pending.length}</b><span>занятий к завершению</span></div><button class="secondary-button" data-go="learning">Моё обучение →</button>`;
  const isTop=employee.grade==='Lead'&&summary.profile.grade==='Lead'&&employee.role===summary.profile.role;
  $('grade-heading').textContent=isTop?'Поддерживать требования Lead':`Что нужно для ${summary.profile.role} · ${summary.profile.grade}`;
  const attained=summary.gaps.reduce((sum,g)=>sum+Math.min(g.current,g.required),0),total=summary.gaps.reduce((sum,g)=>sum+g.required,0);
  $('grade-note').textContent=`Рейтинг = ${attained} освоенных уровней из ${total} требуемых × 100, с округлением. Уровень выше требования не даёт лишних баллов. ${isTop?'В датасете нет грейда выше Lead.':'Выполнение матрицы — ориентир для обсуждения повышения с руководителем, не автоматическое повышение.'}`;
  $('grade-checklist').innerHTML=`<div class="grade-steps"><div><span>01</span><b>Закрыть ключевые разрывы</b><p>Осталось: ${summary.gaps.filter(g=>g.critical&&g.gap>0).length}</p></div><div><span>02</span><b>Пройти маршрут обучения</b><p>Завершить назначения и выбрать подходящие рекомендации.</p></div><div><span>03</span><b>Подтвердить навыки</b><p>Обсудить практические результаты и оценку с руководителем.</p></div></div><div class="table-scroll"><table class="grade-table"><thead><tr><th>Навык</th><th>Сейчас</th><th>Нужно</th><th>Прогресс</th></tr></thead><tbody>${[...summary.gaps].sort((a,b)=>Number(b.critical)-Number(a.critical)||b.gap-a.gap).map(g=>`<tr><td>${escapeHtml(g.name)} ${g.critical?'<span class="key-label">ключевой</span>':''}</td><td>${g.current}</td><td>${g.required}</td><td>${g.gap?'Осталось уровней: '+g.gap:'✓ Выполнено'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderLearning(id) {
  if(workspaceRole!=='employee'||id!==actorId)return;
  const employee=db.employeeById.get(id),summary=employeeSummary(employee),history=employeeHistory(employee);
  const completed=history.filter(r=>r.status==='completed'),pending=pendingLearning(employee),recs=recommendations(employee,summary.profile,summary.levels,summary.gaps).slice(0,3);
  $('learning-metrics').innerHTML=[['Завершено',completed.length],['Обязательных к завершению',pending.filter(r=>db.eventById.get(r.event_id)?.mandatory).length],['В процессе',pending.filter(r=>r.status==='in_progress').length],['Рекомендаций',recs.length]].map(([label,value])=>`<div class="panel hr-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('required-learning').innerHTML=learningRows(pending);
  $('completed-learning').innerHTML=learningRows(completed);
  $('suggested-learning').innerHTML=recs.map(r=>`<article class="learning-row"><div><b>${escapeHtml(r.event.title)}</b><p>${r.event.duration_hours} ч · ${escapeHtml(r.session)} · ${escapeHtml(FORMAT_LABELS[r.event.format]||r.event.format)}</p><p>${r.effects.map(e=>`${escapeHtml(e.name)}: ${e.before} → ${e.after} (цель ${e.required})`).join(' · ')}</p></div><span class="source-badge">Рекомендация</span></article>`).join('')||'<p class="empty-state">Нет доступных занятий с приростом к цели. Обсудите практику или наставничество с руководителем.</p>';
}

function setRole(role) {
  workspaceRole=['hr','employee','manager'].includes(role)?role:'hr';
  $('workspace-role').value=workspaceRole;
  const managers=new Set(db.employees.map(e=>e.manager_id).filter(Boolean));
  const actors=workspaceRole==='manager'?db.employees.filter(e=>managers.has(e.employee_id)):db.employees;
  $('demo-actor').innerHTML=actors.map(e=>`<option value="${e.employee_id}">${escapeHtml(e.full_name)} · ${escapeHtml(e.department)}</option>`).join('');
  actorId=roleActors[workspaceRole]||'E0028';
  $('demo-actor').value=actorId;
  $('demo-actor').hidden=workspaceRole==='hr';$('actor-label').hidden=workspaceRole==='hr';
  $('actor-label').textContent=workspaceRole==='manager'?'Демо-руководитель':'Демо-сотрудник';
  applyRoleContext();
}

function applyRoleContext() {
  ['detail-dialog','connect-dialog'].forEach(id=>{if($(id).open)$(id).close();});
  $('detail-content').innerHTML='';connectionDraft=null;
  priorityFilter='all';tablePage=0;showAllInsights=false;$('employee-search').value='';
  const actor=db.employeeById.get(actorId),people=scopedEmployees();
  const allowed=workspaceRole==='employee'?['employee','learning','integrations']:['hr','people'];
  document.querySelectorAll('.nav-item').forEach(button=>button.hidden=!allowed.includes(button.dataset.view));
  $('role-scope').hidden=false;
  $('role-scope').innerHTML=workspaceRole==='hr'?'<b>Кабинет HR</b><span>Все отделы · 200 сотрудников</span>':workspaceRole==='manager'?`<b>${escapeHtml(actor.full_name)} · Руководитель отдела</b><span>${escapeHtml(actor.department)} · ${people.length} сотрудников отдела</span>`:`<b>${escapeHtml(actor.full_name)} · Сотрудник</b><span>Мои навыки, обучение и рабочие инструменты</span>`;
  $('role-scope').innerHTML+='<small>Демо-разделение интерфейса. Для реальных данных нужны вход и проверка прав на сервере.</small>';
  $('department-filter').hidden=workspaceRole!=='hr';
  $('department-select').innerHTML=workspaceRole==='manager'?`<option value="${escapeHtml(actor.department)}">${escapeHtml(actor.department)}</option>`:'<option value="all">Все отделы</option>'+[...new Set(people.map(e=>e.department))].sort().map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  $('role-select').innerHTML='<option value="all">Все специализации</option>'+[...new Set(people.map(e=>e.role))].sort().map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  $('team-scope-hint').textContent=workspaceRole==='manager'?`Весь ваш отдел: ${actor.department}. Другие отделы в этом кабинете не отображаются.`:'Фильтры применяются к аналитике и списку сотрудников.';
  $('people-heading').textContent=workspaceRole==='manager'?'Сотрудники моего отдела':'Все сотрудники';
  $('analytics-heading').textContent=workspaceRole==='manager'?'Где моему отделу нужна поддержка':'Где сотрудникам нужна поддержка';
  $('employee-select').innerHTML=`<option value="${actorId}">${escapeHtml(actor.full_name)}</option>`;
  $('integration-employee').innerHTML=$('employee-select').innerHTML;
  $('integration-owner').textContent=`${actor.full_name} · ${actor.employee_id}. Вы управляете только своими подключениями.`;
  switchView(allowed[0]);
}

function initRoles() {
  $('workspace-role').addEventListener('change',event=>setRole(event.target.value));
  $('demo-actor').addEventListener('change',event=>{actorId=event.target.value;roleActors[workspaceRole]=actorId;applyRoleContext();});
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.priority&&workspaceRole!=='employee'){priorityFilter=button.dataset.priority;tablePage=0;renderEmployeeTable();}
    if(button.dataset.priorityGo&&workspaceRole!=='employee'){priorityFilter=button.dataset.priorityGo;tablePage=0;switchView('people');}
  });
  setRole('hr');
}
