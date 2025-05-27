<script lang="ts">
  import { PlusCircleIcon, Trash2Icon } from "lucide-svelte";
  import { onDestroy, onMount } from "svelte";
  import type { JSONSchema } from "openai/lib/jsonschema";

  type Field = {
    id: number;
    name: string;
    type: FieldType;
    required: boolean;
    description: string;
    parentId: number | null;
    arrayItemType?: "string" | "number" | "boolean";
    isArrayItem?: boolean;
  };

  type FieldType =
    | "object"
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "array";

  let { source, onSave } = $props();

  let error = $state(null);
  let fields = $state(sourceToFields(source));

  function saveChanges() {
    const newSource = fieldsToSource(fields);
    if (source === newSource) return;
    console.log("Saving changes", newSource);
    onSave(newSource);
  }

  onMount(() => {
    console.log("Mounting schema editor");
  });

  onDestroy(() => {
    console.log("Destroying schema editor");
  });

  const fieldTypes = [
    { display: "Text", value: "string" },
    { display: "Number", value: "number" },
    { display: "True/False", value: "boolean" },
    { display: "Date", value: "date" },
    { display: "List", value: "array" },
    { display: "Object", value: "object" },
  ];

  const arrayItemTypes = [
    { display: "Text", value: "string" },
    { display: "Number", value: "number" },
    { display: "True/False", value: "boolean" },
  ];

  function sourceToFields(source: string) {
    try {
      error = null;
      const schema = JSON.parse(source || "{}");
      if (!schema || typeof schema !== "object") {
        error = `Invalid schema format. Expected a JSON object, got ${typeof schema}`;
        return [];
      }

      const newFields = [];
      let idCounter = 1;

      const parseProperties = (
        properties,
        requiredList = [],
        parentId = null,
      ) => {
        Object.entries(properties).forEach(
          ([propName, propDetails]: [string, JSONSchema]) => {
            const fieldId = idCounter++;
            const field: Field = {
              id: fieldId,
              name: propName,
              type: propDetails.type as FieldType,
              required: requiredList.includes(propName),
              description: propDetails.description || "",
              parentId: parentId,
            };

            if (propDetails.type === "array") {
              // Set array item type based on items schema
              if (
                propDetails.items &&
                typeof propDetails.items === "object" &&
                "type" in propDetails.items
              ) {
                field.arrayItemType = propDetails.items.type as
                  | "string"
                  | "number"
                  | "boolean";
              } else {
                field.arrayItemType = "string"; // Default to string if no items specified
              }
            }

            newFields.push(field);

            if (propDetails.type === "object" && propDetails.properties) {
              parseProperties(
                propDetails.properties,
                propDetails.required || [],
                fieldId,
              );
            }
          },
        );
      };

      if (schema.properties) {
        parseProperties(schema.properties, schema.required || [], null);
      }
      return newFields;
    } catch (err) {
      error = `Error parsing schema: ${err.message}`;
      return [];
    }
  }

  function fieldsToSource(fields: Field[]) {
    const buildProperties = (parentId: number) => {
      const properties = {};
      const required = [];
      fields
        .filter((f) => f.parentId === parentId)
        .forEach((field) => {
          if (field.name.trim() === "") return;
          if (field.type === "object") {
            const { properties: childProperties, required: childRequired } =
              buildProperties(field.id);
            properties[field.name] = {
              type: "object",
              description: field.description || undefined,
              properties: childProperties,
            };
            if (childRequired.length > 0) {
              properties[field.name].required = childRequired;
            }
          } else if (field.type === "array") {
            properties[field.name] = {
              type: "array",
              description: field.description || undefined,
              items: {
                type: field.arrayItemType || "string",
              },
            };
          } else {
            properties[field.name] = {
              type: field.type,
              description: field.description || undefined,
            };
          }
          if (field.required) {
            required.push(field.name);
          }
        });
      return { properties, required };
    };

    const { properties: rootProperties, required: rootRequired } =
      buildProperties(null);

    const schema: JSONSchema = {
      type: "object",
      properties: rootProperties,
    };
    if (rootRequired.length > 0) {
      schema.required = rootRequired;
    }

    return JSON.stringify(schema, null, 2);
  }

  // --- Helpers ---
  function getFullDescendantIds(parentId, currentFields) {
    const directChildren = currentFields.filter((f) => f.parentId === parentId);
    let allDescendantIds = directChildren.map((d) => d.id);

    directChildren.forEach((child) => {
      if (child.type === "object") {
        // Only recurse for objects
        allDescendantIds = allDescendantIds.concat(
          getFullDescendantIds(child.id, currentFields),
        );
      }
    });
    return allDescendantIds;
  }

  // --- Handlers ---
  function handleRemoveField(id: number) {
    const descendantIdsToRemove = getFullDescendantIds(id, fields);
    fields = fields.filter(
      (field) => field.id !== id && !descendantIdsToRemove.includes(field.id),
    );

    // Save changes when a field is removed
    saveChanges();
  }

  function handleTypeChange(id: number, newType: FieldType) {
    const fieldIndex = fields.findIndex((f) => f.id === id);
    if (fieldIndex === -1) return;

    const fieldToUpdate = fields[fieldIndex];

    if (fieldToUpdate.type === "object" && newType !== "object") {
      const descendantIdsToRemove = getFullDescendantIds(id, fields);
      // Filter out descendants first
      let currentFields = fields.filter(
        (f) => !descendantIdsToRemove.includes(f.id),
      );
      // Update the field type
      const updatedFieldIndex = currentFields.findIndex((f) => f.id === id);
      currentFields[updatedFieldIndex].type = newType;
      fields = currentFields; // Assign the new array to trigger update
    } else {
      fieldToUpdate.type = newType;
    }

    // Set default arrayItemType when changing to array
    if (newType === "array" && !fieldToUpdate.arrayItemType) {
      fieldToUpdate.arrayItemType = "string";
    }

    // Clear arrayItemType when changing away from array
    if (newType !== "array") {
      fieldToUpdate.arrayItemType = undefined;
    }

    // Save changes for type change
    saveChanges();
  }

  function handleArrayItemTypeChange(
    arrayFieldId: number,
    newItemType: "string" | "number" | "boolean",
  ) {
    const arrayField = fields.find((f) => f.id === arrayFieldId);
    if (!arrayField) return;

    arrayField.arrayItemType = newItemType;

    saveChanges();
  }

  function createNewField(parentId: number | null = null) {
    const newId =
      fields.length > 0 ? Math.max(0, ...fields.map((f) => f.id)) + 1 : 1;
    return {
      id: newId,
      name: "",
      type: "string",
      required: true,
      description: "",
      parentId,
      arrayItemType: undefined,
    } satisfies Field;
  }

  function addFieldAfter(siblingId: number) {
    const siblingIndex = fields.findIndex((f) => f.id === siblingId);
    if (siblingIndex === -1) return;

    const siblingField = fields[siblingIndex];
    const newField = createNewField(siblingField.parentId);

    fields.splice(siblingIndex + 1, 0, newField);
  }

  function addChildField(parentId: number) {
    const parentIndex = fields.findIndex((f) => f.id === parentId);
    if (parentIndex === -1) return;

    const parentField = fields[parentIndex];
    if (parentField.type !== "object") return;

    const newField = createNewField(parentId);

    // Find last descendant of the parent to insert after, making it the new last child
    const allDescendantIdsOfParent = getFullDescendantIds(parentId, fields);
    let insertAfterIndex = parentIndex;
    if (allDescendantIdsOfParent.length > 0) {
      const lastDescendantId =
        allDescendantIdsOfParent[allDescendantIdsOfParent.length - 1];
      insertAfterIndex = fields.findIndex((f) => f.id === lastDescendantId);
    }

    fields.splice(insertAfterIndex + 1, 0, newField);
  }

  function addTopLevelField() {
    const newField = createNewField(null);
    fields.push(newField);
  }

  // --- Rendering Logic ---
  // Helper to get fields in render order with level
  const fieldsWithLevels = (currentFields, parentId = null, level = 0) => {
    let items = [];
    currentFields
      .filter((f) => f.parentId === parentId)
      .forEach((field) => {
        items.push({ field, level });
        if (field.type === "object") {
          items = items.concat(
            fieldsWithLevels(currentFields, field.id, level + 1),
          );
        }
      });
    return items;
  };
</script>

{#snippet renderFieldSnippet(field, level)}
  {@const isObject = field.type === "object"}
  {@const isArray = field.type === "array"}
  {@const isArrayItem = field.isArrayItem}

  <div
    class="field-row @container"
    style="border-color: var(--background-modifier-border);"
    data-field-id={field.id}
  >
    <div class="flex flex-col @sm:flex-row gap-2 py-1">
      <div class="flex-1" style="padding-left: {level * 20}px;">
        <div>
          <input
            type="text"
            bind:value={field.name}
            class="w-full"
            style="padding: var(--size-4-1) var(--size-4-1); border: 1px solid var(--background-modifier-border); border-radius: var(--input-radius); font-size: var(--font-ui-small); color: var(--text-normal); background-color: transparent;"
            placeholder={isArrayItem ? "Object property name" : "Field name"}
            onblur={() => saveChanges()}
          />

          <input
            type="text"
            bind:value={field.description}
            class="w-full mt-1"
            style="padding: var(--size-4-1) var(--size-4-1); border: 1px solid var(--background-modifier-border); border-radius: var(--input-radius); font-size: var(--font-ui-smaller); color: var(--text-muted); background-color: transparent;"
            placeholder="Description"
          />
        </div>
      </div>
      <!-- field controls -->

      <div class="flex flex-col h-full">
        <div class="flex items-center gap-2">
          <!-- field type -->

          <select
            bind:value={field.type}
            onchange={() => handleTypeChange(field.id, field.type)}
            class="w-full p-1 text-sm border"
            style="background-color: var(--background-primary-alt); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: var(--input-radius); font-size: var(--font-ui-small);"
          >
            {#each fieldTypes as typeOpt (typeOpt.value)}
              <option value={typeOpt.value}>{typeOpt.display}</option>
            {/each}
          </select>

          {#if isArray}
            <select
              bind:value={field.arrayItemType}
              onchange={() =>
                handleArrayItemTypeChange(field.id, field.arrayItemType)}
              class="w-full p-1 text-sm border"
              style="background-color: var(--background-primary-alt); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: var(--input-radius); font-size: var(--font-ui-small);"
            >
              {#each arrayItemTypes as typeOpt (typeOpt.value)}
                <option value={typeOpt.value}>{typeOpt.display}</option>
              {/each}
            </select>
          {/if}

          <!-- field required -->
          <div>
            <label
              class="inline-flex items-center"
              style="font-size: var(--font-ui-smaller); color: var(--text-muted); cursor: pointer;"
            >
              <input
                type="checkbox"
                bind:checked={field.required}
                onchange={() => saveChanges()}
                class="form-checkbox mr-1"
                style="height: 14px; width: 14px; border-radius: var(--checkbox-radius); cursor: pointer;"
              />
              <span>Required</span>
            </label>
          </div>

          <!-- field add/remove -->
          <div class="flex ml-auto">
            <button
              onclick={() => handleRemoveField(field.id)}
              class="p-1 rounded-full hover:opacity-80 clickable-icon"
              style="color: var(--text-accent); background-color: transparent; border: none; cursor: pointer;"
              title="Remove field"
              aria-label="Remove field"
            >
              <Trash2Icon size="16" />
            </button>

            <button
              onclick={() => addFieldAfter(field.id)}
              class="p-1 rounded-full hover:opacity-80 clickable-icon"
              style="color: var(--text-accent); background-color: transparent; border: none; cursor: pointer;"
              title="Add field below"
              aria-label="Add field below"
            >
              <PlusCircleIcon size="16" />
            </button>
          </div>
        </div>

        {#if isObject}
          <div class="flex mt-1 items-center">
            <button
              onclick={() => addChildField(field.id)}
              class="text-xs flex items-center clickable-icon"
              style="background-color: transparent; color: var(--text-accent); border: none; cursor: pointer;"
              aria-label="Add child field"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
              <span class="ml-1">Add field</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

<div class="metadata-properties-heading">
  <div class="metadata-properties-title">Schema</div>
</div>

{#if error}
  <div class="text-(--text-error)">{error}</div>
{:else}
  <div class="fields-container">
    {#if fields.length > 0}
      {#each fieldsWithLevels(fields) as { field, level } (field.id)}
        {@render renderFieldSnippet(field, level)}
      {/each}
    {/if}
    <div class="flex items-center pt-3">
      <button
        onclick={addTopLevelField}
        class="flex items-center text-sm clickable-icon"
        style="color: var(--text-accent); background-color: transparent; border: none; cursor: pointer;"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="16"></line>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
        <span class="ml-1">Add field</span>
      </button>
    </div>
  </div>
{/if}
