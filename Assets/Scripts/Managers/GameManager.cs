using UnityEngine;

namespace HiddenGold.Managers
{
    // Simple singleton so any stone can report score changes
    // without needing a direct reference wired up in the Inspector.
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        [Header("Score")]
        [SerializeField] private int currentScore = 0;

        public int CurrentScore => currentScore;

        // Simple event other scripts (like the UI) can subscribe to.
        public System.Action<int> OnScoreChanged;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        public void AddScore(int amount)
        {
            currentScore += amount;
            if (currentScore < 0) currentScore = 0; // score never goes below zero

            OnScoreChanged?.Invoke(currentScore);
        }
    }
}
