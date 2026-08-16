import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { GLASS_LEVELS } from '../../preferences/glass';
import { Button } from '../../ui/button';
import { Card, GroupLabel, Panel, RowGroup } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { Chip } from '../../ui/chip';
import { Dialog } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Progress } from '../../ui/progress';
import { Range } from '../../ui/range';
import { DenseRow, Row, RowChevron, TreeChildren, TreeRow } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { Select } from '../../ui/select';
import { Spinner } from '../../ui/spinner';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '../../ui/states';
import { Switch } from '../../ui/switch';
import { TextArea } from '../../ui/textarea';

import type { GlassLevel } from '../../preferences/glass';
import type { ReactNode } from 'react';

/**
 * Every component, in every state, in both themes, at all three glass levels.
 *
 * This is how the system stops decaying. A new screen is composed from what is
 * drawn here rather than improvised, and a regression that would otherwise be
 * noticed on one screen in one theme six weeks later is visible in one place
 * immediately. The screenshot tests point at this page for the same reason.
 *
 * The route is registered only outside production. Nothing here is reachable
 * from the app itself.
 *
 * Hover, active and focus specimens are forced with `!` so they can be seen
 * side by side; the last specimen in each group is the live component, which is
 * the one that has to keep agreeing with the drawings next to it.
 */
export function GalleryScreen() {
  return (
    <div className="bg-canvas text-primary">
      <header className="mx-auto flex max-w-[1180px] flex-col gap-12 px-20 pt-56 pb-32">
        <GroupLabel>Neuron</GroupLabel>
        <h1 className="font-display text-32 tracking-tight">Components and every state</h1>
        <p className="max-w-[64ch] text-14 leading-read text-secondary">
          Both themes, all three glass levels. A component that only works in one of them is not
          built yet.
        </p>
      </header>

      {(['dark', 'light'] as const).map((theme) => (
        <section key={theme} data-theme={theme} className="bg-canvas text-primary">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-32 px-20 py-32">
            <GroupLabel>{theme}</GroupLabel>
            <Inventory />
          </div>
        </section>
      ))}

      <section className="mx-auto flex max-w-[1180px] flex-col gap-32 px-20 py-32">
        <GroupLabel>Glass, at every level, in both themes</GroupLabel>

        <div className="grid gap-20 sm:grid-cols-2">
          {(['dark', 'light'] as const).map((theme) =>
            GLASS_LEVELS.map((level) => (
              <GlassSpecimen key={`${theme}-${level}`} theme={theme} level={level} />
            )),
          )}
        </div>

        <GroupLabel>Where it applies</GroupLabel>

        <p className="max-w-[64ch] text-14 leading-read text-secondary">
          Panels only is the default and the rule the system is designed around. Panels and cards
          carries the effect into the content flow, which is one blurred layer per card on every
          scrolled frame.
        </p>

        <div className="grid gap-20 sm:grid-cols-2">
          {(['floating', 'all'] as const).map((scope) => (
            <div key={scope} data-gscope={scope} className="flex flex-col gap-8">
              <State>{scope === 'floating' ? 'panels only' : 'panels and cards'}</State>
              <Card className="flex flex-col gap-8">
                <span className="text-15 text-primary">Deutsch</span>
                <span className="text-13 text-tertiary">1 240 notes · 30 to review</span>
              </Card>
              <Row title="Verben mit Dativ" subtitle="500 notes · 4 new" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** One panel per section, so a section can be read on its own. */
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-16 rounded-24 border border-subtle bg-card p-20">
      <GroupLabel>{title}</GroupLabel>
      {children}
    </div>
  );
}

/** The caption under a specimen, naming the state it is in. */
function State({ children }: { readonly children: ReactNode }) {
  return <span className="font-mono text-12 text-tertiary">{children}</span>;
}

function Inventory() {
  return (
    <div className="grid items-start gap-20 sm:grid-cols-2 lg:grid-cols-3">
      <Actions />
      <TextActions />
      <Fields />
      <Choices />
      <Rows />
      <Containers />
      <Status />
      <ScreenStates />
      <Typography />
    </div>
  );
}

function Actions() {
  const [busy, setBusy] = useState(false);

  return (
    <Section title="Action · primary">
      <div className="flex flex-col gap-8">
        <Button variant="primary">Start reviewing</Button>
        <State>default</State>

        <Button variant="primary" className="bg-fill-accent-hover! shadow-2!">
          Start reviewing
        </Button>
        <State>hover · fill lightens one step</State>

        <Button variant="primary" className="scale-[0.985] shadow-none!">
          Start reviewing
        </Button>
        <State>active · scale .985, shadow off</State>

        <Button
          variant="primary"
          className="outline-2 outline-offset-2 outline-[var(--focus-ring)] shadow-[0_0_0_5px_var(--focus-halo)]!"
        >
          Start reviewing
        </Button>
        <State>focus visible</State>

        <Button variant="primary" disabled>
          Start reviewing
        </Button>
        <State>disabled · never accent</State>

        <Button variant="primary" busy>
          Start reviewing
        </Button>
        <State>loading · width never changes</State>

        <Button
          variant="primary"
          full
          busy={busy}
          onClick={() => {
            setBusy(true);
            window.setTimeout(() => setBusy(false), 1200);
          }}
        >
          Press me, live
        </Button>
        <State>live</State>
      </div>
    </Section>
  );
}

function TextActions() {
  return (
    <Section title="Action · quiet, text, destructive">
      <div className="flex flex-col items-start gap-8">
        <Button variant="quiet">Save as a file</Button>
        <State>quiet · default</State>

        <Button variant="quiet" className="border-strong! bg-fill-neutral-hover! text-primary!">
          Save as a file
        </Button>
        <State>quiet · hover</State>

        <Button variant="quiet" disabled>
          Save as a file
        </Button>
        <State>quiet · disabled</State>

        <div className="h-px w-full bg-subtle" />

        <Button variant="text">Use a recovery code</Button>
        <State>text · default</State>

        <Button variant="text" className="text-primary! underline underline-offset-4">
          Use a recovery code
        </Button>
        <State>text · hover, underline, no colour shift</State>

        <Button variant="destructive" full>
          Delete account
        </Button>
        <State>destructive · a quiet slab, the signal hue only in the word</State>

        <Button variant="destructive" full disabled>
          Delete account
        </Button>
        <State>destructive · disabled</State>
      </div>
    </Section>
  );
}

function Fields() {
  const [text, setText] = useState('anna@fastmail.com');

  return (
    <Section title="Field">
      <div className="flex flex-col gap-8">
        <Input placeholder="anna@fastmail.com" readOnly value="" />
        <State>default · empty</State>

        <Input readOnly value="anna@fastmail.com" className="border-strong!" />
        <State>hover · border one step up</State>

        <Input
          readOnly
          value="anna@fastmail.com"
          className="border-[var(--border-accent)]! shadow-[0_0_0_5px_var(--focus-halo)]"
        />
        <State>focus visible</State>

        <Input readOnly value="anna@fastmail" invalid />
        <span className="text-13 text-error">
          The address is missing everything after the dot. Add the ending.
        </span>
        <State>error · what happened, then what to do</State>

        <Input readOnly value="anna@fastmail.com" disabled />
        <State>disabled</State>

        <Input readOnly value="checking" busy />
        <State>loading · field stays the same size</State>

        <FormField label="Email" hint="The address you sign in with.">
          {(props) => (
            <Input {...props} value={text} onChange={(event) => setText(event.target.value)} />
          )}
        </FormField>
        <State>live, with its label and hint</State>

        <TextArea placeholder="An example sentence" />
        <State>textarea</State>

        <Select defaultValue="ru">
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </Select>
        <State>select · native picker, our chevron</State>

        <Input
          readOnly
          value="123456"
          className="text-center text-24 tracking-[0.4em] tabular-nums"
        />
        <State>code · one field, not six boxes</State>
      </div>
    </Section>
  );
}

function Choices() {
  const [on, setOn] = useState(true);
  const [ticked, setTicked] = useState(false);
  const [choice, setChoice] = useState<GlassLevel>('full');
  const [minutes, setMinutes] = useState(15);

  return (
    <Section title="Choice">
      <div className="flex flex-wrap items-center gap-16">
        <Switch label="off" checked={false} onChange={() => {}} />
        <Switch label="on" checked onChange={() => {}} />
        <Switch label="disabled" checked={false} onChange={() => {}} disabled />
        <Switch label="live" checked={on} onChange={setOn} />
      </div>
      <State>off · on · disabled · live</State>

      <Checkbox checked={ticked} onChange={setTicked}>
        I have saved the codes somewhere I can reach without this phone.
      </Checkbox>
      <State>checkbox · the whole row is the target</State>

      <Segmented
        label="Density"
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'subtle', label: 'Medium' },
          { value: 'full', label: 'Max' },
        ]}
      />
      <State>segmented · replaces radios, two or three options</State>

      <Segmented
        label="Disabled"
        value={choice}
        onChange={setChoice}
        disabled
        options={[
          { value: 'off', label: 'Off' },
          { value: 'full', label: 'Max' },
        ]}
      />
      <State>segmented · disabled</State>

      <div className="flex items-center justify-between">
        <span className="text-13 text-secondary">Minutes a day</span>
        <span data-numeric="" className="text-13 text-tertiary">
          {minutes}
        </span>
      </div>
      <Range value={minutes} min={5} max={60} step={5} onValueChange={setMinutes} />
      <State>range · rail, fill, one white disc</State>
    </Section>
  );
}

function Rows() {
  return (
    <Section title="Row">
      <Row
        title="Deutsch"
        subtitle="1 240 notes · 30 to review"
        trailing={<Chip tone="due">30</Chip>}
      />
      <State>deck row · standalone slab</State>

      <RowGroup>
        <Row
          standalone={false}
          title="Change your password"
          trailing={<RowChevron />}
          onClick={() => {}}
        />
        <Row
          standalone={false}
          title="Replace your recovery codes"
          trailing={<RowChevron />}
          onClick={() => {}}
        />
        <Row
          standalone={false}
          title="Recovery codes"
          subtitle="9 of 10 left"
          trailing={<RowChevron />}
          onClick={() => {}}
        />
      </RowGroup>
      <State>settings rows · separators start at the text</State>

      <div className="flex flex-col gap-8">
        <TreeRow title="Deutsch" subtitle="1 240 notes" expandable expanded onClick={() => {}} />
        <TreeChildren>
          <TreeRow title="Grammatik" subtitle="412 notes" expandable onClick={() => {}} />
          <TreeRow
            title="Verben mit Dativ"
            subtitle="500 notes · 4 new"
            trailing={<Chip tone="due">26</Chip>}
          />
        </TreeChildren>
      </div>
      <State>tree · indentation and a hairline, never a second noun</State>

      <RowGroup>
        <DenseRow
          word="gehorchen"
          meaning="слушаться, подчиняться"
          trailing={<Chip>2 мес.</Chip>}
          onClick={() => {}}
        />
        <DenseRow
          word="zuhören"
          meaning="слушать"
          trailing={<Chip tone="due">сегодня</Chip>}
          onClick={() => {}}
        />
        <DenseRow
          word="widersprechen"
          meaning="возражать"
          trailing={<Chip tone="slipping">ускользает</Chip>}
        />
      </RowGroup>
      <State>dense · two lines, 52px, no avatar, no icon</State>

      <Row title="dienen" subtitle="disabled" disabled onClick={() => {}} />
      <State>disabled</State>
    </Section>
  );
}

function Containers() {
  const [dialog, setDialog] = useState(false);

  return (
    <Section title="Container and floating">
      <Card className="flex flex-col gap-8">
        <span className="text-15 text-primary">Card</span>
        <span className="text-13 text-tertiary">
          canvas, card, raised, floating. Never skip a rung.
        </span>
      </Card>
      <State>card</State>

      <Panel>
        <div className="grid grid-cols-2 gap-8 font-mono text-14 tabular-nums">
          <span>4KQP-2M7J</span>
          <span>W9DX-5TAL</span>
          <span>H3RN-8FZQ</span>
          <span>PB6Y-1CVK</span>
        </div>
      </Panel>
      <State>sunken panel · a well, not a rung</State>

      <div data-g="toast" className="rounded-18 px-16 py-12 text-14">
        Ten codes copied
      </div>
      <State>toast · one line, no action, leaves by itself</State>

      <div data-g="bar" className="flex gap-4 rounded-24 p-8">
        <span className="flex-1 rounded-12 bg-selected px-8 py-12 text-center text-13 font-semibold">
          Today
        </span>
        <span className="flex-1 px-8 py-12 text-center text-13">Decks</span>
        <span className="flex-1 px-8 py-12 text-center text-13">Settings</span>
      </div>
      <State>
        tab bar · every label primary, so the tint can be 0.58 instead of 0.78
      </State>

      <div data-g="panel" className="flex flex-col gap-12 rounded-24 p-16">
        <span className="text-14">Dialog, deeper shadow, thinner over a scrim</span>
        <div data-g="card" className="w-full rounded-12 p-12 text-13 text-secondary">
          Glass inside glass drops its blur automatically. One blurred layer, ever.
        </div>
      </div>
      <State>dialog · and the never-stack rule, enforced in CSS</State>

      <Button variant="quiet" onClick={() => setDialog(true)}>
        Open a real dialog
      </Button>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="A dialog"
        description="Centred in the part of the screen a person can see, at every width."
      >
        <Input placeholder="Type here to bring up the keyboard" />
        <Button variant="primary" full onClick={() => setDialog(false)}>
          Done
        </Button>
      </Dialog>
    </Section>
  );
}

function Status() {
  return (
    <Section title="Status">
      <div className="flex flex-wrap items-center gap-8">
        <Chip tone="due">сегодня</Chip>
        <Chip tone="new">новое</Chip>
        <Chip tone="slipping">ускользает</Chip>
        <Chip>2 мес.</Chip>
      </div>
      <State>due · new · slipping · scheduled. One accent, no other hue.</State>

      <Progress label="Minutes a day" value={11} max={15} />
      <State>progress · scales on transform, never a width</State>

      <Progress label="Password strength" value={0.25} tone="error" />
      <State>strength bar · the one filled line allowed the signal hue</State>

      <div className="flex items-center gap-12 text-secondary">
        <Spinner />
        <span className="text-13">Inside a control that was pressed, and nowhere else</span>
      </div>
      <State>spinner</State>

      <Skeleton className="h-52 w-full" />
      <State>skeleton · the shape of what is coming</State>
    </Section>
  );
}

function ScreenStates() {
  const t = useTranslate();

  return (
    <Section title="Loading, empty, error">
      <SkeletonRows rows={3} />
      <State>loading</State>

      <EmptyState
        title="No decks yet"
        description="Decks show up here as soon as there are any. None of these is a centred icon in a void."
        action={<Button variant="quiet">Add a deck</Button>}
      />
      <State>empty · carries the next action and the reason for it</State>

      <ErrorState
        message="The server is not answering. Your work is saved on this device."
        retryLabel={t('common.retry')}
        onRetry={() => {}}
      />
      <State>error · what happened, then what to do</State>
    </Section>
  );
}

function Typography() {
  return (
    <Section title="Type scale">
      <div className="flex flex-col gap-8">
        {(
          [
            ['56', 'text-56', '42'],
            ['44', 'text-44', 'Сегодня'],
            ['32', 'text-32', 'ausweichen'],
            ['24', 'text-24', 'Наборы'],
            ['20', 'text-20', 'уклоняться, уходить в сторону'],
            ['17', 'text-17', 'Nothing is due until tomorrow morning.'],
            ['15', 'text-15', 'Начать повтор'],
            ['14', 'text-14', 'Повторять можно и без сети.'],
            ['13', 'text-13', 'Осталось 9 из 10 кодов'],
            ['12', 'text-12', 'Waiting in'],
          ] as const
        ).map(([size, className, sample]) => (
          <div key={size} className="flex items-baseline gap-12">
            <span data-numeric="" className="w-24 shrink-0 text-12 text-tertiary">
              {size}
            </span>
            <span className={`${className} font-display tracking-tight`}>{sample}</span>
          </div>
        ))}
      </div>
      <State>one family, the platform's own, at every step of the scale</State>

      <div className="flex flex-col gap-4">
        <span className="font-ui text-15">
          Nothing is downloaded, so nothing reflows when it lands
        </span>
        <span data-numeric="" className="text-15">
          42 · 0123456789 · H3RN-8FZQ · 284 391
        </span>
      </div>
      <State>and the mono, for every number, interval and code</State>
    </Section>
  );
}

/**
 * One glass layer at one level, over content busy enough to show what the blur
 * is doing. Both themes and all three levels are rendered together, because the
 * question the setting answers is what the difference actually looks like.
 */
function GlassSpecimen({ theme, level }: { readonly theme: string; readonly level: GlassLevel }) {
  const words = 'ausweichen · begegnen · widersprechen · gehorchen · zuhören · vertrauen · dienen';

  return (
    <div
      data-theme={theme}
      data-glass={level}
      className="relative overflow-hidden rounded-24 border border-subtle bg-canvas p-20"
    >
      <div className="flex flex-col gap-8 text-14 text-secondary">
        <span className="font-display text-24 text-primary">Verben mit Dativ</span>
        <span>{words}</span>
        <span className="text-accent">Слово живёт не в списке, а в памяти.</span>
        <span>{words}</span>
        <span>Ты видишь его один раз в день, две секунды.</span>
        <span>{words}</span>
      </div>

      {/*
        Over the words, not under them. The whole question a glass level answers
        is what the content underneath looks like through it.
      */}
      <div
        data-g="bar"
        className="absolute inset-x-20 top-1/2 flex -translate-y-1/2 items-center justify-between rounded-18 px-16 py-12"
      >
        <span className="text-14 text-primary">
          {theme} · {level}
        </span>
        <span className="text-13 text-secondary">tertiary reads as secondary here</span>
      </div>
    </div>
  );
}
