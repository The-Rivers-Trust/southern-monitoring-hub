// The year drop-down: every year with data, plus "All years".
const ALL_YEARS = "all";

export function renderYearFilter(selectEl, years, selectedYear, onChange) {
  const addOption = (value, label) => {
    const option = document.createElement("calcite-option");
    option.value = value;
    option.label = label;
    option.selected = value === String(selectedYear ?? ALL_YEARS);
    selectEl.append(option);
  };
  years.forEach((year) => addOption(String(year), String(year)));
  addOption(ALL_YEARS, "All years");

  selectEl.addEventListener("calciteSelectChange", () => {
    onChange(selectEl.value === ALL_YEARS ? null : Number(selectEl.value));
  });
}
