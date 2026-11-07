from rest_framework import serializers

from .models import PANELS, DisplayScreen


class DisplayScreenSerializer(serializers.ModelSerializer):
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = DisplayScreen
        fields = ["id", "name", "token_hint", "panels", "rotate_seconds", "leaders", "leaders_count", "show_values", "celebrate",
                  "sound", "active", "last_seen_at", "created_by", "created_at", "updated_at"]
        read_only_fields = ["token_hint", "last_seen_at", "created_at", "updated_at"]

    def get_created_by(self, obj):
        return (obj.created_by.name or obj.created_by.email) if obj.created_by else None

    def validate_panels(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Choose at least one panel.")
        unknown = [str(p) for p in value if p not in PANELS]
        if unknown:
            raise serializers.ValidationError(f"Unknown panel: {', '.join(unknown)}.")
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Each panel can appear once.")
        return value

    def create(self, validated_data):
        screen = DisplayScreen(**validated_data)
        screen.raw_token = screen.issue_token()   # returned to the admin once by the view; never stored
        screen.save()
        return screen
