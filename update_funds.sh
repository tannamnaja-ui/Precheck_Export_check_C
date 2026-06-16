# SSOP
sed -i 's/<title>ข้าราชการผู้ป่วยนอก (CSOP)<\/title>/<title>ประกันสังคมผู้ป่วยนอก (SSOP)<\/title>/' fund_ssop.html
sed -i 's/<h1>👨‍⚕️ ข้าราชการผู้ป่วยนอก (CSOP)<\/h1>/<h1>💼 ประกันสังคมผู้ป่วยนอก (SSOP)<\/h1>/' fund_ssop.html
sed -i "s/window.fundType = 'csop';/window.fundType = 'ssop';/" fund_ssop.html

# AIPN
sed -i 's/<title>ข้าราชการผู้ป่วยนอก (CSOP)<\/title>/<title>ประกันสังคมผู้ป่วยใน (AIPN)<\/title>/' fund_aipn.html
sed -i 's/<h1>👨‍⚕️ ข้าราชการผู้ป่วยนอก (CSOP)<\/h1>/<h1>🛏️ ประกันสังคมผู้ป่วยใน (AIPN)<\/h1>/' fund_aipn.html
sed -i "s/window.fundType = 'csop';/window.fundType = 'aipn';/" fund_aipn.html

# FDH
sed -i 's/<title>ข้าราชการผู้ป่วยนอก (CSOP)<\/title>/<title>กองทุนทดแทน (FDH)<\/title>/' fund_fdh.html
sed -i 's/<h1>👨‍⚕️ ข้าราชการผู้ป่วยนอก (CSOP)<\/h1>/<h1>🏛️ กองทุนทดแทน (FDH)<\/h1>/' fund_fdh.html
sed -i "s/window.fundType = 'csop';/window.fundType = 'fdh';/" fund_fdh.html

# E-Claim
sed -i 's/<title>ข้าราชการผู้ป่วยนอก (CSOP)<\/title>/<title>E-Claim<\/title>/' fund_eclaim.html
sed -i 's/<h1>👨‍⚕️ ข้าราชการผู้ป่วยนอก (CSOP)<\/h1>/<h1>💳 E-Claim<\/h1>/' fund_eclaim.html
sed -i "s/window.fundType = 'csop';/window.fundType = 'eclaim';/" fund_eclaim.html

# Fee Schedule
sed -i 's/<title>ข้าราชการผู้ป่วยนอก (CSOP)<\/title>/<title>Fee Schedule<\/title>/' fund_feeschedule.html
sed -i 's/<h1>👨‍⚕️ ข้าราชการผู้ป่วยนอก (CSOP)<\/h1>/<h1>📋 Fee Schedule<\/h1>/' fund_feeschedule.html
sed -i "s/window.fundType = 'csop';/window.fundType = 'feeschedule';/" fund_feeschedule.html
