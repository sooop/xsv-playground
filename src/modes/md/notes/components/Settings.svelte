<script lang="ts">
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import {
    settings, persistSettings, applyLayout, FONT_RANGE, WIDTH_RANGE,
  } from '../store.svelte';

  let open = $state(false);

  function layoutChanged() { applyLayout(); persistSettings(); }
  function setFont(e: Event) {
    settings.fontSize = Number((e.currentTarget as HTMLInputElement).value);
    layoutChanged();
  }
  function setWidth(e: Event) {
    settings.contentWidth = Number((e.currentTarget as HTMLInputElement).value);
    layoutChanged();
  }
  function toggleFullWidth() {
    settings.contentWidth = settings.contentWidth > 0 ? 0 : 860;
    layoutChanged();
  }
  function resetLayout() {
    settings.fontSize = 16;
    settings.contentWidth = 860;
    layoutChanged();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="settings">
  <button class="icon-btn" aria-label="설정" aria-expanded={open} onclick={() => (open = !open)}><SettingsIcon size={18} /></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover" role="group" aria-label="설정">
      <div class="field">
        <span class="label">글자 크기 <b>{settings.fontSize}px</b></span>
        <input
          type="range"
          min={FONT_RANGE.min}
          max={FONT_RANGE.max}
          step="1"
          value={settings.fontSize}
          oninput={setFont}
          aria-label="글자 크기"
        />
      </div>

      <div class="field">
        <span class="label">본문 폭 <b>{settings.contentWidth > 0 ? `${settings.contentWidth}px` : '전체'}</b></span>
        <input
          type="range"
          min={WIDTH_RANGE.min}
          max={WIDTH_RANGE.max}
          step="20"
          value={settings.contentWidth > 0 ? settings.contentWidth : WIDTH_RANGE.max}
          disabled={settings.contentWidth === 0}
          oninput={setWidth}
          aria-label="본문 폭"
        />
        <label class="check">
          <input type="checkbox" checked={settings.contentWidth === 0} onchange={toggleFullWidth} />
          <span>창 폭에 맞추기</span>
        </label>
      </div>
      <button class="link-btn" onclick={resetLayout}>글자 크기·본문 폭 기본값으로</button>

    </div>
  {/if}
</div>
