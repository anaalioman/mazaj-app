using UnityEngine;
using UnityEngine.Events;

namespace HiddenGold.Managers
{
    // Concrete subclass so the Inspector can serialize listeners for this
    // event; a raw UnityEvent<int> field won't show persistent calls.
    [System.Serializable]
    public class ScoreChangedEvent : UnityEvent<int> { }

    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        [Header("Scoring")]
        [SerializeField] private int scorePerGold = 100;

        [Header("Level Events")]
        public ScoreChangedEvent onScoreChanged;
        public UnityEvent onLevelComplete;
        public UnityEvent onPlayerShocked;

        public int Score { get; private set; }
        public int TotalGoldCount { get; private set; }
        public int GoldFoundCount { get; private set; }

        private bool _levelComplete;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
        }

        // Every gold stone calls this once (e.g. from its own Start) so the
        // manager knows how many are hidden in the current pile without any
        // scene-specific wiring.
        public void RegisterGoldStone()
        {
            TotalGoldCount++;
        }

        public void ReportGoldFound()
        {
            if (_levelComplete) return;

            GoldFoundCount++;
            AddScore(scorePerGold);

            if (GoldFoundCount >= TotalGoldCount)
            {
                _levelComplete = true;
                onLevelComplete?.Invoke();
            }
        }

        public void ReportTrapTriggered()
        {
            onPlayerShocked?.Invoke();
        }

        public void AddScore(int amount)
        {
            Score += amount;
            onScoreChanged?.Invoke(Score);
        }

        public void ResetLevel()
        {
            Score = 0;
            TotalGoldCount = 0;
            GoldFoundCount = 0;
            _levelComplete = false;
            onScoreChanged?.Invoke(Score);
        }
    }
}
