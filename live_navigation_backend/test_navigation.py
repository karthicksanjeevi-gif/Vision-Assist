import unittest

from navigation_engine import make_navigation_decision
from tracker import CentroidTracker


def detection(label: str, direction: str, risk: str, distance_category: str = "medium", movement: str = "stationary") -> dict:
    return {
        "label": label,
        "confidence": 0.9,
        "direction": direction,
        "in_path": direction == "center",
        "risk": risk,
        "distance_category": distance_category,
        "movement": movement,
        "bbox": {"x1": 280.0, "y1": 220.0, "x2": 360.0, "y2": 420.0},
    }


class NavigationTests(unittest.TestCase):
    def test_clear_scene_is_not_an_obstacle_warning(self) -> None:
        result = make_navigation_decision([])
        self.assertEqual(result["action"], "continue")
        self.assertEqual(result["status"], "clear")
        self.assertIn("clear", result["instruction"])

    def test_center_obstacle_gets_one_safe_direction(self) -> None:
        result = make_navigation_decision([detection("chair", "center", "medium")])
        self.assertIn(result["action"], {"move_left", "move_right", "slow_down"})
        self.assertNotIn("stop", result["instruction"].lower())

    def test_both_sides_blocked_means_stop(self) -> None:
        obstacle = detection("car", "center", "high", "close", "approaching")
        left = detection("wall", "left", "high", "close")
        right = detection("wall", "right", "high", "close")
        result = make_navigation_decision([obstacle, left, right])
        self.assertEqual(result["action"], "stop")
        self.assertGreaterEqual(result["confidence"], 0.58)

    def test_tracker_requires_two_frames(self) -> None:
        tracker = CentroidTracker()
        first = tracker.update([detection("person", "center", "medium")])
        second = tracker.update([detection("person", "center", "medium")])
        self.assertEqual(len(first), 1)
        self.assertFalse(first[0]["confirmed"])
        self.assertEqual(len(second), 1)
        self.assertTrue(second[0]["confirmed"])
        self.assertEqual(second[0]["track_id"], 1)


if __name__ == "__main__":
    unittest.main()
