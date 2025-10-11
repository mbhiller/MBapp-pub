import * as React from "react";
import { AutoCompleteField } from "./AutoCompleteField";
import { getSearchTypes } from "./searchRegistry";

export type ResultItem = { id: string; label: string; type?: string };

export function SalesLinePicker(props: {
  placeholder?: string;
  initialText?: string;
  onSelect: (item: ResultItem) => void;
}) {
  return <AutoCompleteField searchTypes={getSearchTypes("salesLine")} {...props} />;
}

export function CustomerPicker(props: {
  placeholder?: string;
  initialText?: string;
  onSelect: (item: ResultItem) => void;
}) {
  return <AutoCompleteField searchTypes={getSearchTypes("customer")} {...props} />;
}
