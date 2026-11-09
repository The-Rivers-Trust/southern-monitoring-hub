// The catchment partnership drop-down in the header.
const ALL = "all";

export const shortPartnershipName = (name) => name.replace(/ Catchment Partnership$/, "");

export function renderPartnershipFilter(selectEl, names, onChange) {
  const addOption = (value, label) => {
    const option = document.createElement("calcite-option");
    option.value = value;
    option.label = label;
    selectEl.append(option);
  };
  addOption(ALL, "All catchment partnerships");
  [...names]
    .sort((a, b) => shortPartnershipName(a).localeCompare(shortPartnershipName(b)))
    .forEach((name) => addOption(name, shortPartnershipName(name)));

  selectEl.addEventListener("calciteSelectChange", () => {
    onChange(selectEl.value === ALL ? null : selectEl.value);
  });
}
