export const catalog = {
  Question: {
    summary: "Вопрос: варианты и свободный ответ",
    example:
      '<Question id="storage" title="Где хранить данные?" options={["В проекте", "В приложении"]} />',
    rules:
      "Стабильный id. Изменение title/options/version требует переподтверждения. Для семантического изменения вне props увеличьте version. Начальное значение не считается ответом пользователя.",
  },
  Comparison: {
    summary: "Сравнение вариантов",
    example:
      '<Comparison id="options" columns={["Вариант", "Цена"]} rows={[["A", "10"], ["B", "20"]]} />',
  },
  Checklist: {
    summary: "Интерактивный список",
    example:
      '<Checklist id="acceptance" title="Проверки" items={["Тесты", "Ревью"]} />',
  },
  Diagram: {
    summary: "Схема узлов и связей",
    example:
      '<Diagram id="flow" nodes={[{id:"a",label:"Ввод"},{id:"b",label:"Результат"}]} edges={[["a","b"]]} />',
  },
  Image: {
    summary: "Изображение из локального SVG",
    example:
      'import illustration from "./assets/architecture.svg"\n\n<Image id="architecture" src={illustration} alt="Архитектура" />',
  },
  custom: {
    summary: "Произвольный React-компонент",
    example:
      'import Capacity from "./widgets/capacity.tsx"\n\n<Custom id="capacity-block"><Capacity id="capacity" /></Custom>',
    rules:
      'Custom: size="compact" (по умолчанию, максимум 560px), "standard" (720px), "wide" (1040px). Размер адаптируется вниз; широкое содержимое прокручивается внутри блока. Подписи графика оставляйте в HTML; задавайте SVG явную ширину, простым полосам фиксированную высоту. Создайте widgets/capacity.tsx. Импортируйте {useBlueprintState} из "@blueprint/sdk". useBlueprintState(id, initialJSON, definitionJSON?) возвращает [state,setState,confirmed]. Передавайте полное новое JSON-состояние. Третий аргумент описывает смысл/версию вопроса; без него новое содержимое редакции требует переподтверждения. Initial не является пользовательским ответом. Используйте React effect cleanup для таймеров, observers и listeners. Доступны react, react/jsx-runtime, @blueprint/sdk, @blueprint/components и локальные .tsx/.ts/.jsx/.js/.json/.css/.svg/.mdx. Автоустановка npm и внешняя сеть не поддерживаются. Документ исполняется как доверенный код в общем DOM. Ограничивайте CSS своим блоком и сохраняйте состояние через SDK. Не используйте случайные/позиционные ID. Компонент обязан отображать ошибку или неподтверждённое состояние. Пример: export default function Capacity({id}) { const [s,set,ok]=useBlueprintState(id,{workers:2},{version:1}); return <button onClick={()=>set({workers:s.workers+1})}>Workers: {s.workers}{!ok&&" — подтвердите"}</button>; }',
  },
};
export function describeWidget(name?: string) {
  if (!name)
    return Object.entries(catalog).map(([name, v]) => ({
      name,
      summary: v.summary,
    }));
  if (!(name in catalog)) throw new Error("Неизвестный виджет");
  return catalog[name as keyof typeof catalog];
}
