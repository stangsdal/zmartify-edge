import pytest

from app import mqtt_acl


def test_acl_generation_not_implemented_yet():
    with pytest.raises(NotImplementedError):
        mqtt_acl.generate_acl_file()
