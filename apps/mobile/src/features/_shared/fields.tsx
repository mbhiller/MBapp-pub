import * as React from "react";
import { TextInput } from "react-native";
import { AutoCompleteField } from "./AutoCompleteField";
import { getSearchTypes, type SearchKey } from "./searchRegistry";

type Result = { id: string; label: string };

type BaseProps = {
  placeholder?: string;
  initialText?: string;
  inputRef?: React.RefObject<TextInput>;
  onSelect: (r: Result) => void;
  debounceMs?: number;
  minChars?: number;
};

function PickerFor({ searchKey, ...p }: BaseProps & { searchKey: SearchKey }) {
  return (
    <AutoCompleteField
      placeholder={p.placeholder}
      initialText={p.initialText ?? ""}
      searchTypes={getSearchTypes(searchKey)}
      debounceMs={p.debounceMs ?? 220}
      minChars={p.minChars ?? 1}
      inputRef={p.inputRef}
      onSelect={(r) => p.onSelect({ id: r.id, label: r.label })}
      lockAfterPick={true}
    />
  );
}

export function SalesLinePicker(props: BaseProps) {
  return <PickerFor searchKey="salesLine" {...props} />;
}

export function CustomerPicker(props: BaseProps) {
  return <PickerFor searchKey="customer" {...props} />;
}

export function PurchaseLinePicker(p: BaseProps) { return <PickerFor searchKey="purchaseLine" {...p} />; }
export function VendorPicker(p: BaseProps) { return <PickerFor searchKey="vendor" {...p} />; }

