"use client";

import {
  CODING_QUESTIONNAIRE_SECTIONS,
  getAnswerList,
  getAnswerString,
  type CodingQuestion,
  type CodingQuestionSection,
  type CodingQuestionnaireAnswers,
} from "./questions";

type Props = {
  answers: CodingQuestionnaireAnswers;
  onChange: (answers: CodingQuestionnaireAnswers) => void;
};

function setAnswer(
  answers: CodingQuestionnaireAnswers,
  id: string,
  value: string | number | string[],
): CodingQuestionnaireAnswers {
  return {
    ...answers,
    [id]: value,
  };
}

function renderQuestion(params: {
  question: CodingQuestion;
  answers: CodingQuestionnaireAnswers;
  onChange: (answers: CodingQuestionnaireAnswers) => void;
}) {
  const { question, answers, onChange } = params;
  const commonStyle = {
    width: "100%",
    border: "1px solid var(--line, #d9e7f4)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "#fff",
  } as const;

  if (question.type === "yesNo") {
    const value = getAnswerString(answers, question.id);
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {["yes", "no"].map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              className={active ? "button" : "button button-secondary"}
              onClick={() => onChange(setAnswer(answers, question.id, option))}
              aria-pressed={active}
            >
              {option === "yes" ? "Yes" : "No"}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === "number") {
    return (
      <input
        type="number"
        min={question.min}
        max={question.max}
        value={getAnswerString(answers, question.id)}
        onChange={(event) => onChange(setAnswer(answers, question.id, event.target.value))}
        placeholder={question.placeholder}
        style={commonStyle}
      />
    );
  }

  if (question.type === "select") {
    return (
      <select
        value={getAnswerString(answers, question.id)}
        onChange={(event) => onChange(setAnswer(answers, question.id, event.target.value))}
        style={commonStyle}
      >
        <option value="">Select one</option>
        {(question.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (question.type === "multiselect") {
    const selected = new Set(getAnswerList(answers, question.id));
    return (
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {(question.options ?? []).map((option) => {
          const active = selected.has(option.value);
          return (
            <label
              key={option.value}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                border: "1px solid var(--line, #d9e7f4)",
                borderRadius: 8,
                padding: "10px 12px",
                background: active ? "var(--surface-subtle, #f7fbff)" : "#fff",
              }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.value);
                  else next.delete(option.value);
                  onChange(setAnswer(answers, question.id, Array.from(next)));
                }}
              />
              <span>
                <strong>{option.label}</strong>
                {option.description ? <span className="muted" style={{ display: "block", fontSize: 12 }}>{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  if (question.type === "textarea") {
    return (
      <textarea
        value={getAnswerString(answers, question.id)}
        onChange={(event) => onChange(setAnswer(answers, question.id, event.target.value))}
        placeholder={question.placeholder}
        style={{ ...commonStyle, minHeight: 110, resize: "vertical" }}
      />
    );
  }

  return (
    <input
      type="text"
      value={getAnswerString(answers, question.id)}
      onChange={(event) => onChange(setAnswer(answers, question.id, event.target.value))}
      placeholder={question.placeholder}
      style={commonStyle}
    />
  );
}

function SectionCard(props: {
  section: CodingQuestionSection;
  answers: CodingQuestionnaireAnswers;
  onChange: (answers: CodingQuestionnaireAnswers) => void;
}) {
  const { section, answers, onChange } = props;
  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{section.title}</h3>
        {section.description ? <p className="muted" style={{ margin: "6px 0 0 0", fontSize: 13 }}>{section.description}</p> : null}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {section.questions.map((question) => {
          if (question.parentId && getAnswerString(answers, question.parentId) !== question.showWhen) return null;
          return (
            <div key={question.id} style={{ display: "grid", gap: 8 }}>
              <label style={{ fontWeight: 600 }}>{question.label}</label>
              {renderQuestion({ question, answers, onChange })}
              {question.helperText ? <p className="muted" style={{ margin: 0, fontSize: 12 }}>{question.helperText}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function CodingQuestionnaire({ answers, onChange }: Props) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {CODING_QUESTIONNAIRE_SECTIONS.map((section) => (
        <SectionCard key={section.id} section={section} answers={answers} onChange={onChange} />
      ))}
    </div>
  );
}