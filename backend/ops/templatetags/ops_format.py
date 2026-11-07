from django import template

from .. import format as f

register = template.Library()
register.filter("num", f.num)
register.filter("bdt", f.bdt)
register.filter("pct", f.pct)

STATUS = {
    "met": ("Target met", "#036b35", "#e5f6ec"), "onpace": ("On pace", "#036b35", "#e5f6ec"),
    "near": ("Near", "#8a5600", "#fdf3dc"), "behind": ("Behind", "#b4141b", "#fdeceb"), "below": ("Below", "#b4141b", "#fdeceb"),
    "early": ("Just started", "#586274", "#eff1f5"), "none": ("No target", "#586274", "#eff1f5"),
}


@register.inclusion_tag("ops/_status.html")
def status(key):
    """A status chip for the email: a word plus colour, never colour alone."""
    label, fg, bg = STATUS.get(key, STATUS["none"])
    return {"label": label, "fg": fg, "bg": bg}
