@echo off
netsh advfirewall firewall delete rule name="Koide Checklist TCP 4020" >nul 2>&1
netsh advfirewall firewall add rule name="Koide Checklist TCP 4020" dir=in action=allow protocol=TCP localport=4020 profile=domain,private,public
echo Puerto 4020 permitido en el firewall.
pause
