import { bridge } from "./util.ts";
import type * as moduleType from "@codemirror/state";

const module = (await bridge("@codemirror/state")) as typeof moduleType;

export default module;

export const {
  Annotation,
  AnnotationType,
  ChangeDesc,
  ChangeSet,
  CharCategory,
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  Line,
  MapMode,
  Prec,
  Range,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  SelectionRange,
  StateEffect,
  StateEffectType,
  StateField,
  Text,
  Transaction,
  codePointAt,
  codePointSize,
  combineConfig,
  countColumn,
  findClusterBreak,
  findColumn,
  fromCodePoint,
} = module;
