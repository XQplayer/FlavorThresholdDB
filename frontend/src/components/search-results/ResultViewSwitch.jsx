export default function ResultViewSwitch({ value, onChange, isEnglish = false }) {
  const options = [
    { value: 'new', label: isEnglish ? 'New dossier' : '新版档案' },
    { value: 'classic', label: isEnglish ? 'Classic' : '经典版' },
  ];

  return (
    <div
      className="result-view-switch"
      role="group"
      aria-label={isEnglish ? 'Result view' : '结果视图'}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
