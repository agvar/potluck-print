// Guest page: fill in the dish, preview the label, submit it to the print queue.
import './styles.css';
import { supabase, isConfigured, showConfigError } from './supabase.js';
import { ALLERGENS, DIET_TAGS, LIMITS, labelFor, ingredientsAsLine } from './constants.js';

if (!isConfigured) {
  showConfigError();
  throw new Error('Supabase is not configured');
}

const DRAFT_KEY = 'potluck-draft-v1';
const form = document.getElementById('dish-form');
const preview = document.getElementById('preview');
const errorBox = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');
const doneCard = document.getElementById('done');

// ---- Build the allergen / diet checkboxes from the shared lists ----
function renderChips(containerId, list, name) {
  const box = document.getElementById(containerId);
  for (const item of list) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = item.key;
    label.append(input, document.createTextNode(item.label));
    box.append(label);
  }
}
renderChips('allergen-chips', ALLERGENS, 'allergens');
renderChips('diet-chips', DIET_TAGS, 'diet_tags');

// ---- Read the form into a plain object ----
function readForm() {
  const data = new FormData(form);
  return {
    dish_name: String(data.get('dish_name') ?? '').trim(),
    cook_name: String(data.get('cook_name') ?? '').trim(),
    ingredients: String(data.get('ingredients') ?? '').trim(),
    allergens: data.getAll('allergens').map(String),
    diet_tags: data.getAll('diet_tags').map(String),
  };
}

// ---- Live label preview (textContent only, so nothing typed can inject HTML) ----
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderPreview() {
  const d = readForm();
  preview.replaceChildren(
    el('div', 'p-name', d.dish_name || 'Your dish name'),
    el('div', 'p-cook', `by ${d.cook_name || 'your name'}`),
    el('hr'),
    el('div', 'p-allergens', d.allergens.length
      ? `CONTAINS: ${d.allergens.map((k) => labelFor(ALLERGENS, k).toUpperCase()).join(' · ')}`
      : 'Allergens: none declared'),
    ...(d.diet_tags.length ? [el('div', 'p-tags', d.diet_tags.map((k) => labelFor(DIET_TAGS, k)).join(' · '))] : []),
    el('div', 'p-ingredients', `Ingredients: ${ingredientsAsLine(d.ingredients) || '…'}`),
  );
}

// ---- Character counters ----
function renderCounters() {
  const d = readForm();
  const max = { dish_name: LIMITS.dishName, cook_name: LIMITS.cookName, ingredients: LIMITS.ingredients };
  for (const span of document.querySelectorAll('.counter')) {
    const field = span.dataset.for;
    const len = d[field].length;
    span.textContent = len > max[field] * 0.7 ? `${len}/${max[field]}` : '';
  }
}

// ---- Save a draft so a refresh or accidental back doesn't lose typing ----
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(readForm())); } catch { /* private mode */ }
}
function loadDraft() {
  let d;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  for (const f of ['dish_name', 'cook_name', 'ingredients']) form.elements[f].value = d[f] ?? '';
  for (const input of form.querySelectorAll('input[type=checkbox]')) {
    input.checked = (d[input.name] ?? []).includes(input.value);
  }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

function validate(d) {
  if (!d.dish_name) return 'Please enter the dish name.';
  if (!d.cook_name) return 'Please enter your name.';
  if (!d.ingredients) return 'Please list the ingredients.';
  if (d.diet_tags.includes('vegan') && (d.allergens.includes('milk') || d.allergens.includes('eggs'))) {
    return 'You marked this vegan but also "Milk" or "Eggs". Please double-check.';
  }
  return null;
}

function showError(text) {
  errorBox.textContent = text;
  errorBox.hidden = !text;
}

form.addEventListener('input', () => {
  renderPreview();
  renderCounters();
  saveDraft();
  showError('');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const dish = readForm();
  const problem = validate(dish);
  if (problem) return showError(problem);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  // Guests can only INSERT (see supabase/setup.sql), so we don't ask for the row back.
  const { error } = await supabase.from('dishes').insert(dish);
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit for printing';

  if (error) {
    console.error(error);
    return showError('Sorry, that didn\'t go through. Check your internet connection and try again.');
  }
  clearDraft();
  form.reset();
  form.elements.cook_name.value = dish.cook_name; // handy if they bring a second dish
  renderPreview();
  form.hidden = true;
  doneCard.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('another-btn').addEventListener('click', () => {
  doneCard.hidden = true;
  form.hidden = false;
  form.elements.dish_name.focus();
});

loadDraft();
renderPreview();
renderCounters();
