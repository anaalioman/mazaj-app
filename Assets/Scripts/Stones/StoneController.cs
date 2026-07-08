using HiddenGold.Managers;
using UnityEngine;
using UnityEngine.Events;

namespace HiddenGold.Stones
{
    // Requiring Rigidbody/SphereCollider (the 3D physics components) instead of
    // Rigidbody2D/CircleCollider2D guarantees every stone rolls and collides in
    // full 3D, even if someone drags the wrong component onto the prefab later.
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Rigidbody))]
    [RequireComponent(typeof(SphereCollider))]
    public class StoneController : MonoBehaviour
    {
        [Header("Stone Content")]
        [SerializeField] private StoneType stoneType = StoneType.Empty;
        [SerializeField] private int goldScoreValue = 100;

        [Header("Drag Settings")]
        [SerializeField] private float throwForceMultiplier = 8f;

        [Header("Tap Settings")]
        [SerializeField] private float tapMaxDuration = 0.25f;
        [SerializeField] private float tapMaxDragDistance = 0.05f;

        [Header("Reveal Events")]
        public UnityEvent onGoldRevealed;
        public UnityEvent onTrapTriggered;
        public UnityEvent onEmptyRevealed;

        private Rigidbody _rigidbody;
        private SphereCollider _sphereCollider;
        private Camera _mainCamera;

        private bool _isDragging;
        private bool _isRevealed;
        private float _pressStartTime;
        private Vector3 _pressStartPosition;
        private Vector3 _lastPointerWorldPos;
        private Plane _dragPlane;

        private void Awake()
        {
            _rigidbody = GetComponent<Rigidbody>();
            _sphereCollider = GetComponent<SphereCollider>();
            _mainCamera = Camera.main;

            ConfigurePhysicsForRealisticRolling();
        }

        private void ConfigurePhysicsForRealisticRolling()
        {
            _rigidbody.useGravity = true;
            _rigidbody.isKinematic = false;
            _rigidbody.interpolation = RigidbodyInterpolation.Interpolate;
            _rigidbody.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;

            _sphereCollider.isTrigger = false;
        }

        private void OnMouseDown()
        {
            if (_isRevealed) return;

            _isDragging = true;
            _pressStartTime = Time.time;

            _dragPlane = new Plane(Vector3.up, transform.position);
            _pressStartPosition = GetPointerWorldPosition();
            _lastPointerWorldPos = _pressStartPosition;

            // Take manual control while held so the drag tracks the pointer
            // exactly; physics takes back over the instant the stone is released.
            _rigidbody.isKinematic = true;
        }

        private void OnMouseDrag()
        {
            if (!_isDragging) return;

            Vector3 pointerPos = GetPointerWorldPosition();
            Vector3 targetPos = new Vector3(pointerPos.x, transform.position.y, pointerPos.z);

            _rigidbody.MovePosition(targetPos);
            _lastPointerWorldPos = pointerPos;
        }

        private void OnMouseUp()
        {
            if (!_isDragging) return;

            _isDragging = false;
            _rigidbody.isKinematic = false;

            float pressDuration = Time.time - _pressStartTime;
            float dragDistance = Vector3.Distance(_pressStartPosition, _lastPointerWorldPos);

            if (pressDuration <= tapMaxDuration && dragDistance <= tapMaxDragDistance)
            {
                Reveal();
            }
            else
            {
                Vector3 throwDirection = _lastPointerWorldPos - _pressStartPosition;
                _rigidbody.AddForce(throwDirection * throwForceMultiplier, ForceMode.VelocityChange);
            }
        }

        private Vector3 GetPointerWorldPosition()
        {
            Ray ray = _mainCamera.ScreenPointToRay(Input.mousePosition);
            if (_dragPlane.Raycast(ray, out float distance))
            {
                return ray.GetPoint(distance);
            }

            return transform.position;
        }

        public void Reveal()
        {
            if (_isRevealed) return;
            _isRevealed = true;

            switch (stoneType)
            {
                case StoneType.Gold:
                    GameManager.Instance.AddScore(goldScoreValue);
                    onGoldRevealed?.Invoke();
                    break;
                case StoneType.Trap:
                    onTrapTriggered?.Invoke();
                    break;
                default:
                    onEmptyRevealed?.Invoke();
                    break;
            }
        }

        public StoneType GetStoneType() => stoneType;
        public void SetStoneType(StoneType type) => stoneType = type;
    }
}
