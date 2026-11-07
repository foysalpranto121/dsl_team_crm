"""Feature switches (SRS v0.5 §0: build only [MVP]; everything else sits behind feature flags). The V2 features below stay
off until an admin switches them on in Team setup; their data is kept either way."""
from rest_framework.exceptions import NotFound

LABELS = {"tv": "Office TV mode", "huddle": "The morning huddle", "digest": "The weekly digest", "renewals": "The renewal tracker"}


def switch_on(*features):
    """Switch features on (their tests, and setup scripts)."""
    from team.models import TeamSettings
    st = TeamSettings.load()
    for f in features:
        setattr(st, f"feature_{f}", True)
    st.save()


def is_on(feature):
    from team.models import TeamSettings   # core is the base app; team builds on it
    return bool(getattr(TeamSettings.load(), f"feature_{feature}", False))


class FeatureGate:
    """Mix into a DRF view (first in the bases) and set `feature`: requests answer 404 while the feature is switched off."""

    feature = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.feature and not is_on(self.feature):
            raise NotFound(f"{LABELS[self.feature]} is switched off. An admin can switch it on in Team setup → Features.")


_GATES = {f: type(f"{f.title()}Gate", (FeatureGate,), {"feature": f}) for f in LABELS}


def gate(feature):
    """The gate mixin for one feature: class MyView(gate("tv"), APIView)."""
    return _GATES[feature]
