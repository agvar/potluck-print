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
    ...(d.cook_name ? [el('div', 'p-cook', `by ${d.cook_name}`)] : []),
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
  if (!d.ingredients) return 'Please list the ingredients.';
  if (d.diet_tags.includes('vegan') && (d.allergens.includes('milk') || d.allergens.includes('eggs'))) {
    return 'You marked this vegan but also "Dairy" or "Eggs". Please double-check.';
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
  clearPhoto();
  clearSuggestion();
  renderPreview();
  form.hidden = true;
  doneCard.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---- ✨ Suggest ingredients (AI). The AI only proposes; the cook decides. ----
const photoInput = document.getElementById('photo-input');
const photoPreview = document.getElementById('photo-preview');
const photoThumb = document.getElementById('photo-thumb');
const suggestBtn = document.getElementById('suggest-btn');
const suggestError = document.getElementById('suggest-error');
const suggestResult = document.getElementById('suggest-result');
const suggestNote = document.getElementById('suggest-note');
const suggestUse = document.getElementById('suggest-use');
const suggestMaybe = document.getElementById('suggest-maybe');
const suggestChips = document.getElementById('suggest-chips');
let photoDataUrl = null;
let suggestedList = '';

function showSuggestError(text) {
  suggestError.textContent = text;
  suggestError.hidden = !text;
}

// Phone photos are 3-12 MB. Shrink to 1024 px JPEG (~150 KB) before sending:
// faster on party Wi-Fi, cheaper for the AI, and plenty to recognise a dish.
async function shrinkPhoto(file, maxSide = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clearPhoto() {
  photoDataUrl = null;
  photoInput.value = '';
  photoPreview.hidden = true;
  photoThumb.removeAttribute('src');
}

function clearSuggestion() {
  suggestResult.hidden = true;
  suggestChips.replaceChildren();
  suggestedList = '';
  showSuggestError('');
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  showSuggestError('');
  try {
    photoDataUrl = await shrinkPhoto(file);
    photoThumb.src = photoDataUrl;
    photoPreview.hidden = false;
  } catch (error) {
    console.error(error);
    clearPhoto();
    showSuggestError('Couldn\'t read that photo. Try another one.');
  }
});
document.getElementById('photo-remove').addEventListener('click', clearPhoto);

// One "Dairy?" button per allergen / diet tag the AI thinks might apply.
// Tapping it ticks the real checkbox below, so a person always makes the final call.
function renderMaybeChips(data) {
  const items = [
    ...data.possible_allergens.map((key) => ({ name: 'allergens', key, label: labelFor(ALLERGENS, key) })),
    ...data.possible_diet_tags.map((key) => ({ name: 'diet_tags', key, label: labelFor(DIET_TAGS, key) })),
  ];
  suggestChips.replaceChildren(...items.map((item) => {
    const checkbox = form.querySelector(`input[name="${item.name}"][value="${item.key}"]`);
    const button = el('button', 'maybe');
    button.type = 'button';
    const paint = () => {
      button.classList.toggle('yes', checkbox.checked);
      button.textContent = checkbox.checked ? `✓ ${item.label}` : `${item.label}?`;
    };
    paint();
    button.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      paint();
      form.dispatchEvent(new Event('input')); // refresh preview + draft
    });
    return button;
  }));
  suggestMaybe.hidden = items.length === 0;
}

suggestBtn.addEventListener('click', async () => {
  const dishName = form.elements.dish_name.value.trim();
  clearSuggestion();
  if (!dishName && !photoDataUrl) {
    showSuggestError('Type the dish name or add a photo first.');
    return form.elements.dish_name.focus();
  }

  suggestBtn.disabled = true;
  suggestBtn.textContent = 'Thinking…';
  let data;
  try {
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dish_name: dishName, image: photoDataUrl }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Suggestions aren\'t available right now.');
  } catch (error) {
    // fetch() throws a TypeError when the phone can't reach the server at all.
    showSuggestError(error instanceof TypeError ? 'No connection. Please type the ingredients.' : error.message);
    return;
  } finally {
    suggestBtn.disabled = false;
    suggestBtn.textContent = '✨ Suggest ingredients';
  }

  if (!dishName && data.dish_guess) form.elements.dish_name.value = data.dish_guess.slice(0, LIMITS.dishName);
  suggestedList = data.ingredients.join(', ');
  const box = form.elements.ingredients;
  const hasOwnList = box.value.trim() !== '';
  if (suggestedList && !hasOwnList) box.value = suggestedList;

  suggestNote.textContent = [
    data.ingredients.length
      ? (hasOwnList ? 'You already typed a list, so we kept it.' : 'We filled in the ingredients below. Please check them and fix anything that\'s wrong.')
      : 'No ingredients suggested.',
    data.note,
  ].filter(Boolean).join(' ');
  suggestUse.hidden = !(hasOwnList && suggestedList);
  renderMaybeChips(data);
  suggestResult.hidden = false;
  form.dispatchEvent(new Event('input'));
});

suggestUse.addEventListener('click', () => {
  form.elements.ingredients.value = suggestedList;
  suggestUse.hidden = true;
  form.dispatchEvent(new Event('input'));
});

document.getElementById('another-btn').addEventListener('click', () => {
  doneCard.hidden = true;
  form.hidden = false;
  form.elements.dish_name.focus();
});

loadDraft();
renderPreview();
renderCounters();
