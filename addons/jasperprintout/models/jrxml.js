// JRXML for an image print-out: one A4 page per image, the Centrix layout header subreport on
// top and a page footer. Images are report-unit resources referenced as repo:<name>.
// Same layout as the original Jasper Print-Out Builder; its .env values now come from settings.
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const attr = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Text inside CDATA cannot contain "]]>"
const cdata = (v) => String(v == null ? '' : v).replace(/]]>/g, ']]]]><![CDATA[>');

/**
 * @param {string[]} imageNames      resource names, in page order
 * @param {object}   opts
 * @param {string}   opts.reportName
 * @param {string}   opts.version     footer text (HIS report version), optional
 * @param {object}   opts.settings    settings.model get()
 */
exports.generate = function (imageNames, { reportName, version, settings }) {
  const s = settings || {};
  const bands = imageNames.map((name, idx) => `
        <band height="680" splitType="Stretch">
            <!-- Page ${idx + 1} of ${imageNames.length}: ${attr(name).replace(/--/g, '- -')} -->
            <image scaleImage="FillFrame">
                <reportElement positionType="FixRelativeToBottom" x="0" y="0" width="560" height="679" uuid="${uuid()}"/>
                <imageExpression><![CDATA["repo:${cdata(name)}"]]></imageExpression>
            </image>
        </band>`).join('\n');

  const studio = [
    s.dataAdapter && `    <property name="com.jaspersoft.studio.data.defaultdataadapter" value="${attr(s.dataAdapter)}"/>`,
    s.jasperUrl && `    <property name="ireport.jasperserver.url" value="${attr(s.jasperUrl)}"/>`,
    s.jasperUser && `    <property name="ireport.jasperserver.user" value="${attr(s.jasperUser)}"/>`,
    s.reportUnit && `    <property name="ireport.jasperserver.reportUnit" value="${attr(s.reportUnit + '/' + reportName)}"/>`,
    s.reportUnit && `    <property name="ireport.jasperserver.report.resource" value="${attr(s.reportUnit + '/' + reportName + '_files/main_jrxml')}"/>`
  ].filter(Boolean).join('\n');

  const header = s.headerSubreport ? `
    <pageHeader>
        <band height="105">
            <subreport>
                <reportElement x="0" y="0" width="575" height="105" uuid="${uuid()}"/>
                <subreportParameter name="organisationuid">
                    <subreportParameterExpression><![CDATA[$P{organisationuid}]]></subreportParameterExpression>
                </subreportParameter>
                <subreportParameter name="patientvisituid">
                    <subreportParameterExpression><![CDATA[$P{patientvisituid}]]></subreportParameterExpression>
                </subreportParameter>
                <connectionExpression><![CDATA[$P{REPORT_CONNECTION}]]></connectionExpression>
                <subreportExpression><![CDATA["${cdata(s.headerSubreport)}"]]></subreportExpression>
            </subreport>
        </band>
    </pageHeader>` : '';

  const versionText = version ? `
            <staticText>
                <reportElement x="0" y="0" width="220" height="25" uuid="${uuid()}"/>
                <textElement textAlignment="Left" verticalAlignment="Middle"/>
                <text><![CDATA[${cdata(version)}]]></text>
            </staticText>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports http://jasperreports.sourceforge.net/xsd/jasperreport.xsd"
    name="${attr(reportName)}" pageWidth="595" pageHeight="842" columnWidth="555"
    leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="12" uuid="${uuid()}">
${studio}
    <parameter name="patientvisituid" class="java.lang.String">
        <defaultValueExpression><![CDATA["${cdata(s.defaultVisitUid || '')}"]]></defaultValueExpression>
    </parameter>
    <parameter name="organisationuid" class="java.lang.String">
        <defaultValueExpression><![CDATA["${cdata(s.defaultOrgUid || '')}"]]></defaultValueExpression>
    </parameter>

    <queryString language="MongoDbQuery"><![CDATA[{
        runCommand: {
            aggregate : 'patientvisits',
            pipeline : [
                { $match: { statusflag: 'A', _id : {"$oid":  $P{patientvisituid} } } },
                { $project: { "_id":"$_id" } }
            ]
        }
    }]]></queryString>

    <field name="_id" class="org.bson.types.ObjectId"/>

    <background><band splitType="Stretch"/></background>
${header}
    <detail>
${bands}
    </detail>

    <pageFooter>
        <band height="25" splitType="Stretch">
            <textField evaluationTime="Report">
                <reportElement x="271" y="2" width="100" height="20" uuid="${uuid()}"/>
                <textElement textAlignment="Left" verticalAlignment="Middle">
                    <font fontName="TH SarabunPSK" size="12"/>
                </textElement>
                <textFieldExpression><![CDATA[" of " + $V{PAGE_NUMBER}]]></textFieldExpression>
            </textField>${versionText}
            <textField>
                <reportElement x="219" y="-3" width="50" height="22" uuid="${uuid()}">
                    <property name="com.jaspersoft.studio.unit.width" value="px"/>
                </reportElement>
                <textElement textAlignment="Right" verticalAlignment="Bottom">
                    <font fontName="TH SarabunPSK" size="12"/>
                </textElement>
                <textFieldExpression><![CDATA["Page " + $V{PAGE_NUMBER}]]></textFieldExpression>
            </textField>
        </band>
    </pageFooter>
</jasperReport>`;
};
