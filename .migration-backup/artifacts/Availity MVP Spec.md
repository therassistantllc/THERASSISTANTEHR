Captured. I’ll update the spec with \*\*837P only\*\* and these organization/provider assignments.



\## Confirmed Scope Update



\### Transactions



The MVP will support:



| Transaction |      Direction | Scope                          |

| ----------- | -------------: | ------------------------------ |

| \*\*837P\*\*    |         Upload | Professional claims only       |

| \*\*270\*\*     |         Upload | Eligibility inquiry            |

| \*\*276\*\*     |         Upload | Claim status inquiry           |

| \*\*835\*\*     | Download/Parse | ERA/remittance                 |

| \*\*271\*\*     | Download/Parse | Eligibility response           |

| \*\*277\*\*     | Download/Parse | Claim status response          |

| \*\*999\*\*     | Download/Parse | Implementation acknowledgement |



We will \*\*not\*\* build 837I or 837D in MVP.



Availity supports 837 Professional as \*\*ASC X12N 837 005010X222A1\*\*, with an optimal batch size of \*\*5,000 claims or 4 MB\*\*. Availity SFTP submissions use the \*\*SendFiles\*\* folder, while responses are retrieved from \*\*ReceiveFiles\*\*. 



\---



\## Organization Master Data



\### Billing / Submitter Organizations



| Organization              | TIN        | Type 2 NPI | Phone        | Address                                              | Availity Submitter ID |

| ------------------------- | ---------- | ---------: | ------------ | ---------------------------------------------------- | --------------------: |

| Conscious Counseling PLLC | 86-1384084 | 1982355160 | 303-437-2087 | 1556 N. Williams St. Unit 101, Denver, CO 80218-1661 |               1082546 |

| Kindly Kiera LLC          | 85-1383748 | 1770242786 | 720-440-2617 | 1139 York St Apt 306, Denver, CO 80206-3054          |               1062487 |



Assumption: these \*\*Availity IDs\*\* will be used as the organization-level submitter/trading partner identifiers for outbound SFTP batch generation.



\---



\## Clinician Assignments



\### Conscious Counseling PLLC



| Clinician                  | Individual NPI | Email                                                                   | Parent Organization       |

| -------------------------- | -------------: | ----------------------------------------------------------------------- | ------------------------- |

| Camille Ginsburg LPC       |     1093346702 | \[Camille@consciouscounseling.co](mailto:Camille@consciouscounseling.co) | Conscious Counseling PLLC |

| Lyndsey Klemme LPC LAC NCC |     1629632542 | \[Lyndsey@consciouscounseling.co](mailto:Lyndsey@consciouscounseling.co) | Conscious Counseling PLLC |

| Sawyer First LPCC          |     1992547913 | \[Sawyer@consciouscounseling.co](mailto:Sawyer@consciouscounseling.co)   | Conscious Counseling PLLC |

| Adam Wernham               |     1447074430 | \[Adam@consciouscounseling.co](mailto:Adam@consciouscounseling.co)       | Conscious Counseling PLLC |



\### Kindly Kiera LLC



| Clinician                | Individual NPI | Email                                                                                     | Parent Organization |

| ------------------------ | -------------: | ----------------------------------------------------------------------------------------- | ------------------- |

| Kiera Rommel LPC ATR MPS |     1922499581 | \[kindlykiera@creativehealingcolorado.com](mailto:kindlykiera@creativehealingcolorado.com) | Kindly Kiera LLC    |



SSNs will be treated as sensitive credentialing data and stored only if required. They should \*\*not\*\* be placed in normal 837P claim files unless a payer-specific companion rule explicitly requires it.



\---



\## Draft Database Seed Model



```sql

CREATE TABLE organizations (

&#x20; id UUID PRIMARY KEY,

&#x20; legal\_name TEXT NOT NULL,

&#x20; tin TEXT NOT NULL,

&#x20; organization\_npi TEXT NOT NULL,

&#x20; phone TEXT NOT NULL,

&#x20; address\_line1 TEXT NOT NULL,

&#x20; address\_line2 TEXT,

&#x20; city TEXT NOT NULL,

&#x20; state CHAR(2) NOT NULL,

&#x20; postal\_code TEXT NOT NULL,

&#x20; availity\_submitter\_id TEXT NOT NULL,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE clinicians (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; full\_name TEXT NOT NULL,

&#x20; credential\_text TEXT,

&#x20; individual\_npi TEXT NOT NULL,

&#x20; email TEXT,

&#x20; encrypted\_ssn BYTEA,

&#x20; ssn\_last4 CHAR(4),

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



Confirmed.



\## Method — Part 1: Availity SFTP + EDI Identity Mapping



\### MVP Transaction Scope



Only these modules are in scope:



| Module   |       Direction | X12 Version    | Notes                          |

| -------- | --------------: | -------------- | ------------------------------ |

| \*\*837P\*\* | Outbound upload | `005010X222A1` | Professional claims only       |

| \*\*270\*\*  | Outbound upload | `005010X279A1` | Eligibility inquiry            |

| \*\*276\*\*  | Outbound upload | `005010X212`   | Claim status inquiry           |

| \*\*835\*\*  |   Inbound parse | `005010X221A1` | ERA/remittance                 |

| \*\*271\*\*  |   Inbound parse | `005010X279A1` | Eligibility response           |

| \*\*277\*\*  |   Inbound parse | `005010X212`   | Claim status response          |

| \*\*999\*\*  |   Inbound parse | `005010`       | Implementation acknowledgement |



Availity supports SFTP upload through \*\*SendFiles\*\* and response retrieval through \*\*ReceiveFiles\*\*. The guide lists 837P as \*\*005010X222A1\*\* and recommends an optimal 837 batch size of \*\*5,000 claims or 4 MB\*\*. 



\---



\## Organization and Provider Mapping



\### Billing Provider / Submitter Organizations



For \*\*837P\*\*, the organization will be the \*\*billing provider\*\*, and the clinician will be the \*\*rendering provider\*\*.



| Organization              | Billing NPI | TIN        | Availity Submitter ID |

| ------------------------- | ----------: | ---------- | --------------------: |

| Conscious Counseling PLLC |  1982355160 | 86-1384084 |               1082546 |

| Kindly Kiera LLC          |  1770242786 | 85-1383748 |               1062487 |



\### Rendering Providers



| Clinician                  | Rendering NPI | Parent Organization       |

| -------------------------- | ------------: | ------------------------- |

| Camille Ginsburg LPC       |    1093346702 | Conscious Counseling PLLC |

| Lyndsey Klemme LPC LAC NCC |    1629632542 | Conscious Counseling PLLC |

| Sawyer First LPCC          |    1992547913 | Conscious Counseling PLLC |

| Adam Wernham               |    1447074430 | Conscious Counseling PLLC |

| Kiera Rommel LPC ATR MPS   |    1922499581 | Kindly Kiera LLC          |



SSNs will be stored only in an encrypted credentialing table, masked in logs/UI, and excluded from normal 837P generation unless a payer-specific companion rule requires them.



\---



\## Availity Envelope Rules



Per the guide, outbound batch files submitted to Availity should use Availity-specific ISA/GS routing values. The Availity Submitter IDs you provided will be used at the application/submitter level, not as raw payer IDs.



\### ISA Envelope



```text

ISA01 = 00

ISA02 = 10 blank spaces

ISA03 = 00

ISA04 = 10 blank spaces

ISA05 = ZZ

ISA06 = AV09311993 padded to 15 chars

ISA07 = 01

ISA08 = 030240928 padded to 15 chars

ISA11 = ^

ISA12 = 00501

ISA14 = 1

ISA15 = T for QA, P for production

ISA16 = :

Segment terminator = \~

```



Availity specifies the default delimiters as `\*`, `:`, `\~`, and `^`, and requires unique control numbers across ISA/IEA, GS/GE, and ST/SE. 



\### GS Values by Outbound Module



| Module | GS01 | GS02                               | GS03        | GS08           |

| ------ | ---- | ---------------------------------- | ----------- | -------------- |

| 837P   | `HC` | Organization Availity Submitter ID | `030240928` | `005010X222A1` |

| 270    | `HS` | Organization Availity Submitter ID | `030240928` | `005010X279A1` |

| 276    | `HR` | Organization Availity Submitter ID | `030240928` | `005010X212`   |



\---



\## Database Seed Structure



```sql

CREATE TABLE organizations (

&#x20; id UUID PRIMARY KEY,

&#x20; legal\_name TEXT NOT NULL,

&#x20; tin\_raw TEXT NOT NULL,

&#x20; tin\_normalized CHAR(9) NOT NULL,

&#x20; billing\_npi CHAR(10) NOT NULL,

&#x20; phone TEXT NOT NULL,

&#x20; address\_line1 TEXT NOT NULL,

&#x20; address\_line2 TEXT,

&#x20; city TEXT NOT NULL,

&#x20; state CHAR(2) NOT NULL,

&#x20; postal\_code TEXT NOT NULL,

&#x20; availity\_submitter\_id TEXT NOT NULL,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE

);



CREATE TABLE clinicians (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; full\_name TEXT NOT NULL,

&#x20; credential\_text TEXT,

&#x20; rendering\_npi CHAR(10) NOT NULL,

&#x20; email TEXT,

&#x20; ssn\_last4 CHAR(4),

&#x20; encrypted\_ssn BYTEA,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE

);

```



Confirmed. Conscious Counseling claims will \*\*always use Lyndsey Klemme as the 837P rendering provider\*\*, regardless of the clinician attached to the visit internally.



\## Method — Part 2: 837P Provider Assignment Rules



\### 837P Scope



Only \*\*837 Professional / 005010X222A1\*\* will be generated for claims. 



\---



\## 837P Billing and Rendering Provider Rules



\### Conscious Counseling PLLC



| EDI Role                      | Value                          |

| ----------------------------- | ------------------------------ |

| Billing Provider Organization | Conscious Counseling PLLC      |

| Billing Provider NPI          | `1982355160`                   |

| Billing Provider TIN          | `861384084`                    |

| Availity Submitter ID         | `1082546`                      |

| 837P Rendering Provider       | \*\*Lyndsey Klemme LPC LAC NCC\*\* |

| Rendering Provider NPI        | `1629632542`                   |



Business rule:



```text

For every 837P claim where organization = Conscious Counseling PLLC:

&#x20; use billing\_provider\_npi = 1982355160

&#x20; use billing\_provider\_tin = 861384084

&#x20; use rendering\_provider\_npi = 1629632542

&#x20; use rendering\_provider\_name = Lyndsey Klemme

```



Other Conscious Counseling clinicians may remain attached to the appointment, encounter, or internal chart, but they will \*\*not\*\* be emitted as the 837P rendering provider.



\---



\### Kindly Kiera LLC



| EDI Role                      | Value                        |

| ----------------------------- | ---------------------------- |

| Billing Provider Organization | Kindly Kiera LLC             |

| Billing Provider NPI          | `1770242786`                 |

| Billing Provider TIN          | `851383748`                  |

| Availity Submitter ID         | `1062487`                    |

| 837P Rendering Provider       | \*\*Kiera Rommel LPC ATR MPS\*\* |

| Rendering Provider NPI        | `1922499581`                 |



Business rule:



```text

For every 837P claim where organization = Kindly Kiera LLC:

&#x20; use billing\_provider\_npi = 1770242786

&#x20; use billing\_provider\_tin = 851383748

&#x20; use rendering\_provider\_npi = 1922499581

&#x20; use rendering\_provider\_name = Kiera Rommel

```



\---



\## Database Rule Update



```sql

ALTER TABLE organizations

ADD COLUMN default\_rendering\_clinician\_id UUID REFERENCES clinicians(id);



ALTER TABLE claims

ADD COLUMN service\_clinician\_id UUID REFERENCES clinicians(id),

ADD COLUMN edi\_rendering\_clinician\_id UUID REFERENCES clinicians(id);

```



Claim creation rule:



```sql

UPDATE claims c

SET edi\_rendering\_clinician\_id = o.default\_rendering\_clinician\_id

FROM organizations o

WHERE c.organization\_id = o.id

&#x20; AND c.edi\_rendering\_clinician\_id IS NULL;

```



Great — locking that in.



\## Method — Part 3: Batch Processing Architecture



Availity batch exchange will use \*\*SFTP first\*\*. Outbound files are uploaded to \*\*SendFiles\*\*, and inbound response files are downloaded from \*\*ReceiveFiles\*\*. The guide also notes QA and production SFTP endpoints: `qa-files.availity.com` and `files.availity.com`, both on port `22`. 



```plantuml id="batch-edi-architecture"

@startuml

actor User



rectangle "Application" {

&#x20; component "Claims / Eligibility / Status UI" as UI

&#x20; component "EDI API" as API

&#x20; component "Batch Orchestrator" as Orchestrator

&#x20; component "837P Generator" as G837

&#x20; component "270 Generator" as G270

&#x20; component "276 Generator" as G276

&#x20; component "Inbound Parser" as Parser

&#x20; component "Response Mapper" as Mapper

}



database "PostgreSQL" as DB

cloud "Object Storage\\nRaw X12 Files" as Store

component "SFTP Connector" as SFTP

cloud "Availity MFT\\nSendFiles / ReceiveFiles" as Availity



User --> UI

UI --> API

API --> Orchestrator



Orchestrator --> G837

Orchestrator --> G270

Orchestrator --> G276



G837 --> Store

G270 --> Store

G276 --> Store



Orchestrator --> SFTP

SFTP --> Availity : upload outbound batch to SendFiles

SFTP --> Availity : poll/download ReceiveFiles



SFTP --> Store : save raw inbound file

Store --> Parser

Parser --> Mapper

Mapper --> DB

@enduml

```



\## Batch Lifecycle



```text id="batch-lifecycle"

DRAFT

&#x20; -> READY\_FOR\_BATCH

&#x20; -> BATCH\_CREATED

&#x20; -> UPLOADED\_TO\_AVAILITY

&#x20; -> AVAILITY\_NOTIFICATION\_RECEIVED

&#x20; -> 999\_RECEIVED

&#x20; -> RESPONSE\_RECEIVED

&#x20; -> PARSED

&#x20; -> POSTED\_OR\_REQUIRES\_REVIEW

```



Failure states:



```text id="batch-failure-states"

VALIDATION\_FAILED

UPLOAD\_FAILED

ACK\_REJECTED

999\_REJECTED

PAYER\_REJECTED

PARSER\_FAILED

DUPLICATE\_FILE

MANUAL\_REVIEW\_REQUIRED

```



\## SFTP Connector Rules



\### QA



```text id="qa-sftp"

host = qa-files.availity.com

port = 22

protocol = SFTP

upload\_folder = SendFiles

download\_folder = ReceiveFiles

ISA15 = T

```



\### Production



```text id="prod-sftp"

host = files.availity.com

port = 22

protocol = SFTP

upload\_folder = SendFiles

download\_folder = ReceiveFiles

ISA15 = P

```



\## Polling Schedule



MVP default:



```text id="polling"

Outbound upload job: every 15 minutes

Inbound ReceiveFiles polling: every 15 minutes

Nightly reconciliation job: 1x per night

Manual upload/download/reprocess: available from admin UI

```



Availity removes/archive rules matter for operations: notification files in \*\*SendFiles\*\* are removed nightly, and response files in \*\*ReceiveFiles\*\* are archived after 30 days, so our downloader should poll regularly and store a permanent internal copy. 



Confirmed:



1\. \*\*One Availity SFTP mailbox per organization\*\*

2\. \*\*Actual payer IDs from our payer table\*\* are used for outbound 837P / 270 / 276 routing, with Availity as the transport clearinghouse



\## Method — Part 4: Core Database Model



Availity upload/download will use \*\*SendFiles\*\* for outbound files and \*\*ReceiveFiles\*\* for inbound response files. Because Availity removes notification files nightly and archives ReceiveFiles after 30 days, the system must store every uploaded and downloaded raw file internally. 



```sql id="edi-core-schema"

CREATE TABLE organizations (

&#x20; id UUID PRIMARY KEY,

&#x20; legal\_name TEXT NOT NULL,

&#x20; tin\_normalized CHAR(9) NOT NULL,

&#x20; billing\_npi CHAR(10) NOT NULL,

&#x20; phone TEXT NOT NULL,

&#x20; address\_line1 TEXT NOT NULL,

&#x20; address\_line2 TEXT,

&#x20; city TEXT NOT NULL,

&#x20; state CHAR(2) NOT NULL,

&#x20; postal\_code TEXT NOT NULL,

&#x20; availity\_submitter\_id TEXT NOT NULL,

&#x20; default\_rendering\_clinician\_id UUID,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE clinicians (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; full\_name TEXT NOT NULL,

&#x20; credential\_text TEXT,

&#x20; rendering\_npi CHAR(10) NOT NULL,

&#x20; email TEXT,

&#x20; ssn\_last4 CHAR(4),

&#x20; encrypted\_ssn BYTEA,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



ALTER TABLE organizations

ADD CONSTRAINT fk\_default\_rendering\_clinician

FOREIGN KEY (default\_rendering\_clinician\_id)

REFERENCES clinicians(id);

```



\## Organization Defaults



```sql id="organization-default-rules"

\-- Conscious Counseling PLLC

\-- billing\_npi = 1982355160

\-- tin = 861384084

\-- availity\_submitter\_id = 1082546

\-- default rendering clinician = Lyndsey Klemme, NPI 1629632542



\-- Kindly Kiera LLC

\-- billing\_npi = 1770242786

\-- tin = 851383748

\-- availity\_submitter\_id = 1062487

\-- default rendering clinician = Kiera Rommel, NPI 1922499581

```



\## Payer Table



```sql id="payer-schema"

CREATE TABLE payers (

&#x20; id UUID PRIMARY KEY,

&#x20; payer\_name TEXT NOT NULL,

&#x20; payer\_id TEXT NOT NULL,

&#x20; availity\_enabled BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; supports\_837p BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; supports\_270 BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; supports\_276 BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; requires\_enrollment BOOLEAN NOT NULL DEFAULT FALSE,

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\## Claim Tables for 837P



```sql id="claims-schema"

CREATE TABLE claims (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; payer\_id UUID NOT NULL REFERENCES payers(id),

&#x20; patient\_id UUID NOT NULL,

&#x20; service\_clinician\_id UUID REFERENCES clinicians(id),

&#x20; edi\_rendering\_clinician\_id UUID NOT NULL REFERENCES clinicians(id),



&#x20; claim\_control\_number TEXT NOT NULL,

&#x20; patient\_control\_number TEXT NOT NULL,

&#x20; total\_charge\_amount NUMERIC(12,2) NOT NULL,



&#x20; place\_of\_service\_code TEXT NOT NULL,

&#x20; diagnosis\_code\_1 TEXT NOT NULL,

&#x20; diagnosis\_code\_2 TEXT,

&#x20; diagnosis\_code\_3 TEXT,

&#x20; diagnosis\_code\_4 TEXT,



&#x20; status TEXT NOT NULL DEFAULT 'READY\_FOR\_BATCH',

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE claim\_service\_lines (

&#x20; id UUID PRIMARY KEY,

&#x20; claim\_id UUID NOT NULL REFERENCES claims(id),

&#x20; line\_number INT NOT NULL,

&#x20; service\_date DATE NOT NULL,

&#x20; cpt\_code TEXT NOT NULL,

&#x20; modifier\_1 TEXT,

&#x20; modifier\_2 TEXT,

&#x20; modifier\_3 TEXT,

&#x20; modifier\_4 TEXT,

&#x20; charge\_amount NUMERIC(12,2) NOT NULL,

&#x20; units NUMERIC(8,2) NOT NULL DEFAULT 1,

&#x20; diagnosis\_pointer TEXT NOT NULL DEFAULT '1'

);

```



\## Eligibility and Claim Status Requests



```sql id="270-276-schema"

CREATE TABLE eligibility\_requests (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; payer\_id UUID NOT NULL REFERENCES payers(id),

&#x20; patient\_id UUID NOT NULL,

&#x20; request\_control\_number TEXT NOT NULL,

&#x20; service\_type\_code TEXT,

&#x20; status TEXT NOT NULL DEFAULT 'READY\_FOR\_BATCH',

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE claim\_status\_requests (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; payer\_id UUID NOT NULL REFERENCES payers(id),

&#x20; claim\_id UUID REFERENCES claims(id),

&#x20; patient\_id UUID NOT NULL,

&#x20; request\_control\_number TEXT NOT NULL,

&#x20; payer\_claim\_control\_number TEXT,

&#x20; status TEXT NOT NULL DEFAULT 'READY\_FOR\_BATCH',

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\## EDI Batch Tracking



```sql id="edi-batch-schema"

CREATE TABLE edi\_batches (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; transaction\_type TEXT NOT NULL, -- 837P, 270, 276

&#x20; environment TEXT NOT NULL,      -- QA, PROD



&#x20; isa\_control\_number TEXT NOT NULL,

&#x20; gs\_control\_number TEXT NOT NULL,

&#x20; file\_name TEXT NOT NULL,

&#x20; file\_hash TEXT NOT NULL,



&#x20; status TEXT NOT NULL DEFAULT 'CREATED',

&#x20; uploaded\_at TIMESTAMPTZ,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),



&#x20; UNIQUE(environment, isa\_control\_number),

&#x20; UNIQUE(file\_hash)

);



CREATE TABLE edi\_batch\_items (

&#x20; id UUID PRIMARY KEY,

&#x20; batch\_id UUID NOT NULL REFERENCES edi\_batches(id),

&#x20; source\_table TEXT NOT NULL, -- claims, eligibility\_requests, claim\_status\_requests

&#x20; source\_id UUID NOT NULL,

&#x20; st\_control\_number TEXT NOT NULL,

&#x20; status TEXT NOT NULL DEFAULT 'IN\_BATCH'

);

```



\## Inbound File Tracking



```sql id="edi-inbound-schema"

CREATE TABLE edi\_inbound\_files (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; file\_name TEXT NOT NULL,

&#x20; file\_extension TEXT NOT NULL,

&#x20; file\_hash TEXT NOT NULL,

&#x20; transaction\_type TEXT, -- 835, 271, 277, 999, ACK, TA1

&#x20; raw\_storage\_uri TEXT NOT NULL,

&#x20; parsed\_at TIMESTAMPTZ,

&#x20; status TEXT NOT NULL DEFAULT 'DOWNLOADED',

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),



&#x20; UNIQUE(file\_hash)

);



CREATE TABLE edi\_acknowledgements (

&#x20; id UUID PRIMARY KEY,

&#x20; inbound\_file\_id UUID NOT NULL REFERENCES edi\_inbound\_files(id),

&#x20; related\_batch\_id UUID REFERENCES edi\_batches(id),

&#x20; ack\_type TEXT NOT NULL, -- 999, TA1, ACK

&#x20; accepted BOOLEAN NOT NULL,

&#x20; error\_code TEXT,

&#x20; error\_segment TEXT,

&#x20; error\_message TEXT,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\## Conscious Counseling Rendering Provider Rule



```sql id="conscious-rendering-provider-rule"

UPDATE claims c

SET edi\_rendering\_clinician\_id = o.default\_rendering\_clinician\_id

FROM organizations o

WHERE c.organization\_id = o.id

&#x20; AND o.legal\_name = 'Conscious Counseling PLLC';

```



\## Method — Part 5: 837P Generator



The MVP will generate \*\*837P Professional Claims only\*\*, using Availity-supported version \*\*005010X222A1\*\*. Availity’s guide recommends an optimal 837 batch size of \*\*5,000 claims or 4 MB\*\*, so the generator will split batches before either limit is exceeded. 



\---



\## 837P Provider Rules



\### Conscious Counseling PLLC



```text

Billing Provider:

&#x20; Organization: Conscious Counseling PLLC

&#x20; NPI: 1982355160

&#x20; TIN: 861384084



Rendering Provider:

&#x20; Lyndsey Klemme

&#x20; NPI: 1629632542

```



\### Kindly Kiera LLC



```text

Billing Provider:

&#x20; Organization: Kindly Kiera LLC

&#x20; NPI: 1770242786

&#x20; TIN: 851383748



Rendering Provider:

&#x20; Kiera Rommel

&#x20; NPI: 1922499581

```



\---



\## 837P Loop Mapping



| X12 Loop | Segment                               | Source                                  |

| -------- | ------------------------------------- | --------------------------------------- |

| ISA/IEA  | Interchange envelope                  | Organization Availity SFTP config       |

| GS/GE    | Functional group                      | Organization Availity submitter ID      |

| ST/SE    | Transaction set                       | Generated batch transaction             |

| BHT      | Beginning of hierarchical transaction | Batch metadata                          |

| 1000A    | Submitter                             | Billing organization                    |

| 1000B    | Receiver                              | Availity receiver config                |

| 2000A    | Billing provider HL                   | Billing organization                    |

| 2010AA   | Billing provider name/address         | Organization NPI, TIN, address          |

| 2000B    | Subscriber HL                         | Subscriber / insured record             |

| 2010BA   | Subscriber demographics               | Subscriber table                        |

| 2010BB   | Payer                                 | Actual payer from payer table           |

| 2000C    | Patient HL                            | Only when patient is not subscriber     |

| 2010CA   | Patient demographics                  | Patient table                           |

| 2300     | Claim information                     | Claim table                             |

| 2310B    | Rendering provider                    | Organization default rendering provider |

| 2400     | Service line                          | Claim service lines                     |



\---



\## Outbound 837P Skeleton



```x12

ISA\*00\*          \*00\*          \*ZZ\*{SUBMITTER\_ID}  \*ZZ\*{AVAILITY\_RECEIVER\_ID}\*{YYMMDD}\*{HHMM}\*^\*00501\*{ISA13}\*1\*{T\_OR\_P}\*:\~

GS\*HC\*{SUBMITTER\_ID}\*{AVAILITY\_RECEIVER\_ID}\*{YYYYMMDD}\*{HHMM}\*{GS06}\*X\*005010X222A1\~

ST\*837\*{ST02}\*005010X222A1\~

BHT\*0019\*00\*{BATCH\_TRACE\_ID}\*{YYYYMMDD}\*{HHMM}\*CH\~



NM1\*41\*2\*{SUBMITTER\_ORG\_NAME}\*\*\*\*\*46\*{SUBMITTER\_ID}\~

PER\*IC\*EDI SUPPORT\*TE\*{ORG\_PHONE}\~

NM1\*40\*2\*AVAILITY\*\*\*\*\*46\*{AVAILITY\_RECEIVER\_ID}\~



HL\*1\*\*20\*1\~

NM1\*85\*2\*{BILLING\_ORG\_NAME}\*\*\*\*\*XX\*{BILLING\_NPI}\~

N3\*{BILLING\_ADDRESS\_LINE\_1}\~

N4\*{CITY}\*{STATE}\*{ZIP}\~

REF\*EI\*{TIN}\~



HL\*2\*1\*22\*{PATIENT\_HL\_CHILD\_CODE}\~

SBR\*P\*{RELATIONSHIP\_CODE}\*\*\*\*\*\*\*CI\~

NM1\*IL\*1\*{SUBSCRIBER\_LAST}\*{SUBSCRIBER\_FIRST}\*\*\*\*MI\*{MEMBER\_ID}\~

N3\*{SUBSCRIBER\_ADDRESS\_LINE\_1}\~

N4\*{CITY}\*{STATE}\*{ZIP}\~

DMG\*D8\*{DOB}\*{GENDER}\~

NM1\*PR\*2\*{PAYER\_NAME}\*\*\*\*\*PI\*{PAYER\_ID}\~



CLM\*{PATIENT\_CONTROL\_NUMBER}\*{TOTAL\_CHARGE\_AMOUNT}\*\*\*{POS\_CODE}:B:1\*Y\*A\*Y\*Y\~

HI\*ABK:{PRIMARY\_DIAGNOSIS\_CODE}\~



NM1\*82\*1\*{RENDERING\_LAST}\*{RENDERING\_FIRST}\*\*\*\*XX\*{RENDERING\_NPI}\~



LX\*1\~

SV1\*HC:{CPT\_CODE}:{MOD1}:{MOD2}\*{CHARGE\_AMOUNT}\*UN\*{UNITS}\*\*\*{DIAGNOSIS\_POINTER}\~

DTP\*472\*D8\*{SERVICE\_DATE}\~



SE\*{SEGMENT\_COUNT}\*{ST02}\~

GE\*1\*{GS06}\~

IEA\*1\*{ISA13}\~

```



\---



\## Generator Algorithm



```text

1\. Select claims where status = READY\_FOR\_BATCH.

2\. Group by:

&#x20;  - organization

&#x20;  - payer

&#x20;  - environment

3\. Apply organization rendering provider rule.

4\. Validate claim data.

5\. Assign unique ISA13, GS06, ST02, and patient control numbers.

6\. Generate 837P X12.

7\. Estimate file size.

8\. Split batch if:

&#x20;  - claim count > 5,000

&#x20;  - file size approaches 4 MB

9\. Store raw X12 file.

10\. Create edi\_batches and edi\_batch\_items records.

11\. Mark claims as BATCH\_CREATED.

12\. Queue file for SFTP upload to Availity SendFiles.

```



\---



\## Required Pre-Upload Validation



A claim cannot be batched unless it has:



```text

organization

payer

patient

subscriber

member\_id

billing provider NPI

billing provider TIN

rendering provider NPI

diagnosis code

place of service code

at least one CPT service line

service date

charge amount

claim control number

```



For Conscious Counseling, validation will additionally enforce:



```text

edi\_rendering\_clinician\_id = Lyndsey Klemme

edi\_rendering\_npi = 1629632542

```



\---



\## 837P Sequence



```plantuml

@startuml

actor User

participant "Claims UI" as UI

participant "EDI API" as API

participant "837P Generator" as Gen

database "PostgreSQL" as DB

participant "Object Storage" as Store

participant "SFTP Upload Job" as SFTP

cloud "Availity SendFiles" as Availity



User -> UI : Mark claims ready

UI -> API : Create 837P batch

API -> DB : Load claims, org, payer, patient, service lines

API -> Gen : Generate 837P

Gen -> Gen : Apply rendering provider rules

Gen -> Gen : Validate X12 data

Gen -> Store : Save raw .837 file

Gen -> DB : Create edi\_batches + edi\_batch\_items

DB -> SFTP : Queue upload job

SFTP -> Availity : Upload to SendFiles

SFTP -> DB : Mark UPLOADED\_TO\_AVAILITY

@enduml

```



Confirmed:



\* MVP supports \*\*patient is not subscriber\*\* scenarios.

\* 837P batches will be grouped by \*\*organization + payer + environment\*\*.

\* Each batch file will be easier to reconcile because it will not mix payers.



\## Method — Part 6: 270 Eligibility + 276 Claim Status Generators



Availity supports batch \*\*270/271\*\* using `005010X279A1` and batch \*\*276/277\*\* using `005010X212`. Both have a recommended optimal batch size of \*\*4 MB\*\*. Files are uploaded through \*\*SendFiles\*\*, and responses are downloaded from \*\*ReceiveFiles\*\*. 



\---



\## 270 Eligibility Inquiry Generator



\### Purpose



Generate outbound eligibility inquiry batches before or near the appointment date.



\### Batch Grouping



```text

270 batches grouped by:

&#x20; organization

&#x20; payer

&#x20; environment

```



\### Required Data



```text

organization

payer

subscriber or patient

member\_id

patient first name

patient last name

date of birth

gender

service type code

date of service or inquiry date

```



\### Default Service Type Code



```text

30 = Health Benefit Plan Coverage

```



For therapy/behavioral health, we can later support payer-specific service type codes, but MVP should default to `30`.



\### 270 Flow



```plantuml

@startuml

actor User

participant "Eligibility UI" as UI

participant "EDI API" as API

participant "270 Generator" as Gen

database "PostgreSQL" as DB

participant "Object Storage" as Store

participant "SFTP Upload Job" as SFTP

cloud "Availity SendFiles" as Availity



User -> UI : Request eligibility check

UI -> API : Create 270 request

API -> DB : Load org, payer, subscriber, patient

API -> Gen : Generate 270 X12

Gen -> Store : Save raw .270 file

Gen -> DB : Create edi\_batches + edi\_batch\_items

SFTP -> Availity : Upload to SendFiles

@enduml

```



\---



\## 276 Claim Status Inquiry Generator



\### Purpose



Generate outbound claim status inquiry batches for claims that need payer status updates.



\### Batch Grouping



```text

276 batches grouped by:

&#x20; organization

&#x20; payer

&#x20; environment

```



\### Required Data



```text

organization

payer

billing provider NPI

billing provider TIN

subscriber or patient

member\_id

patient name

patient date of birth

claim total charge

claim service date

patient control number

```



\### Preferred Claim Identifier



```text

Use payer\_claim\_control\_number if available.

Otherwise use internal patient\_control\_number from the submitted 837P.

```



\---



\## Database Additions



```sql

CREATE TABLE edi\_service\_type\_codes (

&#x20; id UUID PRIMARY KEY,

&#x20; code TEXT NOT NULL,

&#x20; description TEXT NOT NULL,

&#x20; is\_default BOOLEAN NOT NULL DEFAULT FALSE

);



INSERT INTO edi\_service\_type\_codes (id, code, description, is\_default)

VALUES (

&#x20; gen\_random\_uuid(),

&#x20; '30',

&#x20; 'Health Benefit Plan Coverage',

&#x20; TRUE

);



ALTER TABLE eligibility\_requests

ADD COLUMN inquiry\_date DATE NOT NULL DEFAULT CURRENT\_DATE,

ADD COLUMN service\_type\_code TEXT NOT NULL DEFAULT '30';



ALTER TABLE claim\_status\_requests

ADD COLUMN claim\_charge\_amount NUMERIC(12,2),

ADD COLUMN service\_date DATE,

ADD COLUMN patient\_control\_number TEXT,

ADD COLUMN payer\_claim\_control\_number TEXT;

```



\---



\## Generator Reuse



The 270 and 276 generators should reuse the same infrastructure as 837P:



```text

control number service

payer routing table

organization Availity submitter config

SFTP upload queue

raw file storage

batch/item tracking

pre-upload validation

```



Locked in.



\## Method — Part 6 Update: 270 Eligibility + 276 Claim Status Rules



Availity supports batch \*\*270/271\*\* using `005010X279A1` and batch \*\*276/277\*\* using `005010X212`, both with a recommended optimal batch size of \*\*4 MB\*\*. Outbound files go to \*\*SendFiles\*\*, and inbound responses are retrieved from \*\*ReceiveFiles\*\*. 



\---



\## 270 Eligibility Inquiry Rule



\### Default Eligibility Service Type Code



```text id="eligibility-service-type"

service\_type\_code = 98

```



So every MVP 270 eligibility request will default to:



```text id="270-default"

EQ\*98\~

```



Unless a payer-specific rule overrides it later.



\### Updated Database Rule



```sql id="270-service-type-update"

ALTER TABLE eligibility\_requests

ALTER COLUMN service\_type\_code SET DEFAULT '98';



UPDATE eligibility\_requests

SET service\_type\_code = '98'

WHERE service\_type\_code IS NULL

&#x20;  OR service\_type\_code = '30';

```



\### 270 Validation



```text id="270-validation"

Required before batching:

&#x20; organization

&#x20; payer

&#x20; payer\_id

&#x20; subscriber/member\_id

&#x20; patient/subscriber name

&#x20; date of birth

&#x20; gender

&#x20; inquiry date

&#x20; service\_type\_code = 98 by default

```



\---



\## 276 Claim Status Rule



276 claim status requests will only be generated after the related claim has passed the Availity acknowledgement stage.



```text id="276-generation-rule"

A claim is eligible for 276 only when:

&#x20; claim.status IN (

&#x20;   '999\_ACCEPTED',

&#x20;   'AVAILITY\_ACCEPTED',

&#x20;   'PAYER\_PENDING',

&#x20;   'SUBMITTED\_TO\_PAYER'

&#x20; )



Do not create 276 when:

&#x20; claim.status IN (

&#x20;   'VALIDATION\_FAILED',

&#x20;   'UPLOAD\_FAILED',

&#x20;   'ACK\_REJECTED',

&#x20;   'TA1\_REJECTED',

&#x20;   '999\_REJECTED',

&#x20;   'PAYER\_REJECTED'

&#x20; )

```



\### Preferred 276 Claim Identifier



```text id="276-identifier-rule"

Use payer\_claim\_control\_number when available.

Otherwise use original 837P patient\_control\_number.

```



\---



\## Updated Generator Scope



| Module | Outbound Trigger        | Batch Grouping                     | Upload Folder |

| ------ | ----------------------- | ---------------------------------- | ------------- |

| 837P   | Ready claims            | Organization + payer + environment | SendFiles     |

| 270    | Eligibility request     | Organization + payer + environment | SendFiles     |

| 276    | Claim accepted past 999 | Organization + payer + environment | SendFiles     |



Next I’ll define the \*\*835 / 271 / 277 / 999 inbound parser design\*\*, including how parsed responses update claims, eligibility records, and batch statuses.



\## Method — Part 7: Inbound Parser Design for 835 / 271 / 277 / 999



Availity generates response files for submitted batch files, and the organization’s reporting preferences control which acknowledgements and reports are delivered. Response files are downloaded from \*\*ReceiveFiles\*\*. Availity also notes that response files left in ReceiveFiles are archived after \*\*30 days\*\*, so the system must download and store permanent internal copies. 



\---



\## Inbound File Types in MVP



| File Type     | Purpose                            | Parser Action                                                  |

| ------------- | ---------------------------------- | -------------------------------------------------------------- |

| \*\*999\*\*       | X12 implementation acknowledgement | Mark batch accepted/rejected at syntax/implementation level    |

| \*\*835\*\*       | ERA / remittance advice            | Store payments, adjustments, denials, check/EFT metadata       |

| \*\*271\*\*       | Eligibility response               | Update eligibility request result                              |

| \*\*277\*\*       | Claim status response              | Update claim status inquiry result and optionally claim status |

| \*\*ACK / TA1\*\* | File/interchange acknowledgement   | Store as batch-level transport/envelope status                 |



\---



\## Inbound Processing Flow



```plantuml id="inbound-parser-flow"

@startuml

participant "SFTP Poller" as SFTP

cloud "Availity ReceiveFiles" as Availity

participant "Object Storage" as Store

participant "Inbound File Registry" as Registry

participant "Parser Router" as Router

participant "999 Parser" as P999

participant "835 Parser" as P835

participant "271 Parser" as P271

participant "277 Parser" as P277

database "PostgreSQL" as DB



SFTP -> Availity : List ReceiveFiles

SFTP -> Availity : Download new files

SFTP -> Store : Save raw file

SFTP -> Registry : Register file hash + filename



Registry -> Router : Route by extension/content

Router -> P999 : 999

Router -> P835 : 835 / ERA

Router -> P271 : 271

Router -> P277 : 277



P999 -> DB : Update edi\_batches + edi\_acknowledgements

P835 -> DB : Insert remittance records

P271 -> DB : Update eligibility response

P277 -> DB : Update claim status response

@enduml

```



\---



\## Parser Router Rules



```text id="parser-router-rules"

1\. Download file from ReceiveFiles.

2\. Compute SHA-256 hash.

3\. If hash already exists:

&#x20;  - mark as DUPLICATE\_FILE

&#x20;  - do not parse again unless manually forced

4\. Store raw file in object storage.

5\. Determine parser using:

&#x20;  - file extension

&#x20;  - X12 ST01 transaction code

&#x20;  - fallback content inspection

6\. Parse into normalized tables.

7\. Link inbound file to outbound edi\_batch when possible using:

&#x20;  - ISA13

&#x20;  - GS06

&#x20;  - ST02

&#x20;  - payer trace numbers

&#x20;  - patient control number

8\. Mark file PARSED or PARSER\_FAILED.

```



\---



\## 999 Parser



Availity automatically sends negative 999 acknowledgements, and positive 999 acknowledgements can be configured through reporting preferences. The 999 indicates whether functional groups passed implementation-level validation. 



\### Stored Data



```sql id="999-schema"

CREATE TABLE edi\_999\_results (

&#x20; id UUID PRIMARY KEY,

&#x20; inbound\_file\_id UUID NOT NULL REFERENCES edi\_inbound\_files(id),

&#x20; related\_batch\_id UUID REFERENCES edi\_batches(id),



&#x20; functional\_group\_control\_number TEXT,

&#x20; transaction\_set\_control\_number TEXT,

&#x20; accepted BOOLEAN NOT NULL,



&#x20; ak1\_functional\_id\_code TEXT,

&#x20; ak1\_group\_control\_number TEXT,

&#x20; ak2\_transaction\_set\_id TEXT,

&#x20; ak2\_transaction\_set\_control\_number TEXT,

&#x20; ik5\_status\_code TEXT,

&#x20; ak9\_status\_code TEXT,



&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE edi\_999\_errors (

&#x20; id UUID PRIMARY KEY,

&#x20; result\_id UUID NOT NULL REFERENCES edi\_999\_results(id),

&#x20; segment\_id\_code TEXT,

&#x20; segment\_position TEXT,

&#x20; loop\_identifier TEXT,

&#x20; element\_position TEXT,

&#x20; error\_code TEXT,

&#x20; error\_message TEXT,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\### 999 Status Mapping



```text id="999-status-mapping"

If AK9/IK5 accepted:

&#x20; edi\_batch.status = 999\_ACCEPTED

&#x20; source items remain SUBMITTED\_TO\_AVAILITY



If AK9/IK5 rejected:

&#x20; edi\_batch.status = 999\_REJECTED

&#x20; source items become REJECTED\_BY\_999

&#x20; claims/eligibility/status requests require correction and rebatch

```



\---



\## 835 ERA Parser



\### Purpose



Parse payment/remittance information and link it back to claims where possible.



\### Matching Priority



```text id="835-match-priority"

1\. CLP patient control number -> claims.patient\_control\_number

2\. Payer claim control number -> claims.payer\_claim\_control\_number

3\. Subscriber/member + service dates + charge amount

4\. Manual review queue

```



\### Database Tables



```sql id="835-schema"

CREATE TABLE era\_files (

&#x20; id UUID PRIMARY KEY,

&#x20; inbound\_file\_id UUID NOT NULL REFERENCES edi\_inbound\_files(id),

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),



&#x20; payer\_name TEXT,

&#x20; payer\_identifier TEXT,

&#x20; payment\_method\_code TEXT,

&#x20; payment\_amount NUMERIC(12,2),

&#x20; payment\_date DATE,

&#x20; trace\_number TEXT,

&#x20; production\_date DATE,



&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE era\_claims (

&#x20; id UUID PRIMARY KEY,

&#x20; era\_file\_id UUID NOT NULL REFERENCES era\_files(id),

&#x20; claim\_id UUID REFERENCES claims(id),



&#x20; patient\_control\_number TEXT,

&#x20; payer\_claim\_control\_number TEXT,

&#x20; claim\_status\_code TEXT,

&#x20; total\_charge\_amount NUMERIC(12,2),

&#x20; paid\_amount NUMERIC(12,2),

&#x20; patient\_responsibility\_amount NUMERIC(12,2),



&#x20; matched\_status TEXT NOT NULL DEFAULT 'UNMATCHED',

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE TABLE era\_adjustments (

&#x20; id UUID PRIMARY KEY,

&#x20; era\_claim\_id UUID NOT NULL REFERENCES era\_claims(id),

&#x20; group\_code TEXT,

&#x20; reason\_code TEXT,

&#x20; amount NUMERIC(12,2),

&#x20; quantity NUMERIC(8,2),

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\### 835 Claim Update Rule



```text id="835-claim-update"

If ERA claim matched:

&#x20; update claim.paid\_amount

&#x20; update claim.patient\_responsibility\_amount

&#x20; update claim.payer\_claim\_control\_number when present

&#x20; set claim.status based on CLP status:

&#x20;   paid/processed -> REMITTED

&#x20;   denied -> DENIED

&#x20;   partial -> PARTIALLY\_PAID

If unmatched:

&#x20; send to MANUAL\_REVIEW\_REQUIRED

```



\---



\## 271 Eligibility Response Parser



\### Purpose



Parse eligibility response and update the original 270 request.



\### Database Tables



```sql id="271-schema"

CREATE TABLE eligibility\_responses (

&#x20; id UUID PRIMARY KEY,

&#x20; inbound\_file\_id UUID NOT NULL REFERENCES edi\_inbound\_files(id),

&#x20; eligibility\_request\_id UUID REFERENCES eligibility\_requests(id),



&#x20; payer\_id UUID REFERENCES payers(id),

&#x20; patient\_id UUID,

&#x20; subscriber\_member\_id TEXT,



&#x20; response\_status TEXT NOT NULL, -- ACTIVE, INACTIVE, ERROR, UNKNOWN

&#x20; service\_type\_code TEXT,

&#x20; plan\_name TEXT,

&#x20; coverage\_level\_code TEXT,

&#x20; benefit\_amount NUMERIC(12,2),

&#x20; benefit\_percent NUMERIC(5,2),

&#x20; message TEXT,



&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\### 271 Status Mapping



```text id="271-status-mapping"

If active coverage found:

&#x20; eligibility\_requests.status = ACTIVE



If inactive or no coverage:

&#x20; eligibility\_requests.status = INACTIVE



If payer/member validation error:

&#x20; eligibility\_requests.status = REJECTED\_OR\_ERROR



If response cannot be confidently interpreted:

&#x20; eligibility\_requests.status = MANUAL\_REVIEW\_REQUIRED

```



\---



\## 277 Claim Status Parser



\### Purpose



Parse claim status responses and update the original 276 request.



\### Database Tables



```sql id="277-schema"

CREATE TABLE claim\_status\_responses (

&#x20; id UUID PRIMARY KEY,

&#x20; inbound\_file\_id UUID NOT NULL REFERENCES edi\_inbound\_files(id),

&#x20; claim\_status\_request\_id UUID REFERENCES claim\_status\_requests(id),

&#x20; claim\_id UUID REFERENCES claims(id),



&#x20; payer\_claim\_control\_number TEXT,

&#x20; patient\_control\_number TEXT,

&#x20; status\_category\_code TEXT,

&#x20; status\_code TEXT,

&#x20; entity\_code TEXT,

&#x20; status\_message TEXT,



&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\### 277 Update Rule



```text id="277-update-rule"

If 277 matches a claim:

&#x20; update claim.payer\_claim\_control\_number when present

&#x20; update claim.external\_status\_category\_code

&#x20; update claim.external\_status\_code

&#x20; update claim.external\_status\_message

&#x20; update claim.last\_status\_checked\_at



If 277 cannot match:

&#x20; create unmatched claim\_status\_response

&#x20; send to MANUAL\_REVIEW\_REQUIRED

```



\---



\## Inbound Parser Failure Handling



```text id="inbound-parser-failure"

If parsing fails:

&#x20; edi\_inbound\_files.status = PARSER\_FAILED

&#x20; preserve raw file

&#x20; log parser error

&#x20; allow manual reprocess



If matching fails:

&#x20; parser still succeeds

&#x20; parsed record status = UNMATCHED

&#x20; queue manual review



If duplicate file:

&#x20; do not parse by default

&#x20; allow admin override reprocess

```



\## Confirmation



For 835 files, I’ll assume MVP should \*\*parse and store ERA details but not auto-post payments into accounting/billing balances until reviewed\*\*.



Confirmed: \*\*835 ERA files will be parsed and stored, but MVP will not auto-post payments\*\* until a user reviews/approves them.



\## Method — Part 8: ERA Review + Posting Control



Availity supports inbound \*\*835 ERA\*\* files through the same \*\*ReceiveFiles\*\* download flow as other response files. The system will store the raw file, parse remittance details, and place matched/unmatched payment records into a review queue. 



\---



\## 835 Processing Rule



```text id="835-mvp-processing-rule"

When an 835 file is downloaded:

&#x20; 1. Save raw file to object storage.

&#x20; 2. Parse BPR/TRN payment header.

&#x20; 3. Parse payer/payee information.

&#x20; 4. Parse CLP claim payment records.

&#x20; 5. Parse CAS adjustment records.

&#x20; 6. Match each CLP to an internal claim.

&#x20; 7. Store parsed ERA records.

&#x20; 8. Do NOT update financial balances automatically.

&#x20; 9. Place records into ERA\_REVIEW\_REQUIRED.

```



\---



\## ERA Review Statuses



```text id="era-review-statuses"

UNMATCHED

MATCHED\_PENDING\_REVIEW

APPROVED\_FOR\_POSTING

POSTED

REJECTED\_BY\_USER

NEEDS\_CORRECTION

```



\---



\## Database Additions



```sql id="era-review-schema"

ALTER TABLE era\_claims

ADD COLUMN review\_status TEXT NOT NULL DEFAULT 'MATCHED\_PENDING\_REVIEW',

ADD COLUMN reviewed\_by UUID,

ADD COLUMN reviewed\_at TIMESTAMPTZ,

ADD COLUMN posted\_at TIMESTAMPTZ,

ADD COLUMN posting\_notes TEXT;



CREATE TABLE era\_review\_events (

&#x20; id UUID PRIMARY KEY,

&#x20; era\_claim\_id UUID NOT NULL REFERENCES era\_claims(id),

&#x20; event\_type TEXT NOT NULL,

&#x20; old\_status TEXT,

&#x20; new\_status TEXT,

&#x20; notes TEXT,

&#x20; created\_by UUID,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



\---



\## Claim Balance Update Rule



```text id="era-posting-rule"

Only after user approval:

&#x20; claim.paid\_amount += era\_claim.paid\_amount

&#x20; claim.patient\_responsibility\_amount = era\_claim.patient\_responsibility\_amount

&#x20; claim.status = REMITTED / DENIED / PARTIALLY\_PAID

&#x20; claim.payer\_claim\_control\_number = era\_claim.payer\_claim\_control\_number when present

```



\---



\## ERA Review Flow



```plantuml id="era-review-flow"

@startuml

actor BillingUser

participant "835 Parser" as Parser

database "PostgreSQL" as DB

participant "ERA Review UI" as UI

participant "Posting Service" as Posting



Parser -> DB : Store parsed ERA claim

Parser -> DB : Set MATCHED\_PENDING\_REVIEW or UNMATCHED



BillingUser -> UI : Review ERA claim

UI -> DB : Load claim + payment + adjustments



BillingUser -> UI : Approve posting

UI -> Posting : Post approved ERA

Posting -> DB : Update claim balances/status

Posting -> DB : Mark ERA claim POSTED

@enduml

```



\## Next section



Next I’ll define the \*\*SFTP jobs, file naming conventions, retries, and duplicate handling\*\* for Availity SendFiles/ReceiveFiles.



\## Method — Part 9: Availity SFTP Jobs, File Naming, Retries, and Duplicate Handling



Availity SFTP uses:



| Environment | Host                    | Port | Upload Folder | Download Folder |

| ----------- | ----------------------- | ---: | ------------- | --------------- |

| QA          | `qa-files.availity.com` | `22` | `SendFiles`   | `ReceiveFiles`  |

| Production  | `files.availity.com`    | `22` | `SendFiles`   | `ReceiveFiles`  |



Outbound files are placed in \*\*SendFiles\*\*. Response files, acknowledgements, batch reports, and 835 ERA files are retrieved from \*\*ReceiveFiles\*\*. Notification files in SendFiles are archived nightly, and response files in ReceiveFiles are archived after 30 days, so the platform must download frequently and store its own permanent copy. 



\---



\## SFTP Account Model



Each organization has its own Availity SFTP mailbox.



```sql

CREATE TABLE edi\_sftp\_accounts (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; environment TEXT NOT NULL, -- QA, PROD

&#x20; host TEXT NOT NULL,

&#x20; port INT NOT NULL DEFAULT 22,

&#x20; username TEXT NOT NULL,

&#x20; encrypted\_password BYTEA NOT NULL,

&#x20; upload\_folder TEXT NOT NULL DEFAULT 'SendFiles',

&#x20; download\_folder TEXT NOT NULL DEFAULT 'ReceiveFiles',

&#x20; is\_active BOOLEAN NOT NULL DEFAULT TRUE,

&#x20; last\_successful\_upload\_at TIMESTAMPTZ,

&#x20; last\_successful\_download\_at TIMESTAMPTZ,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),



&#x20; UNIQUE (organization\_id, environment)

);

```



\---



\## Internal Outbound File Naming



Use deterministic internal names for audit and support.



```text

{ORG\_SHORT}\_{TRANSACTION}\_{PAYER\_ID}\_{ENV}\_{YYYYMMDDHHMMSS}\_{ISA13}.x12

```



Examples:



```text

CC\_837P\_12345\_PROD\_20260601143000\_000000123.x12

KK\_270\_67890\_PROD\_20260601143500\_000000124.x12

CC\_276\_12345\_QA\_20260601144000\_000000125.x12

```



File extensions may also be transaction-specific if preferred:



```text

.837

.270

.276

```



MVP recommendation: use `.x12` internally and rely on transaction metadata, `GS01`, and `ST01` for routing.



\---



\## Upload Job



```text

1\. Find edi\_batches where status = CREATED or UPLOAD\_RETRY\_READY.

2\. Load organization SFTP account for environment.

3\. Verify raw outbound file exists in object storage.

4\. Connect to Availity SFTP.

5\. Upload file to SendFiles.

6\. Confirm remote file exists.

7\. Mark edi\_batches.status = UPLOADED\_TO\_AVAILITY.

8\. Record upload timestamp.

9\. Queue notification/response polling.

```



\### Upload Retry Policy



```text

Retry schedule:

&#x20; attempt 1: immediate

&#x20; attempt 2: +5 minutes

&#x20; attempt 3: +15 minutes

&#x20; attempt 4: +30 minutes

&#x20; attempt 5: +60 minutes



After 5 failed attempts:

&#x20; status = UPLOAD\_FAILED

&#x20; requires manual review

```



\---



\## Download Poller



```text

1\. For each active organization SFTP account:

2\. Connect to ReceiveFiles.

3\. List remote files.

4\. Skip files already downloaded by remote filename + size + modified timestamp.

5\. Download new file.

6\. Compute SHA-256 hash.

7\. If hash already exists:

&#x20;  - mark duplicate

&#x20;  - do not parse again by default

8\. Store raw file in object storage.

9\. Create edi\_inbound\_files record.

10\. Route to parser:

&#x20;  - 999 parser

&#x20;  - 835 parser

&#x20;  - 271 parser

&#x20;  - 277 parser

&#x20;  - ACK/TA1 parser

11\. Mark parsed status.

```



\---



\## Remote File Handling



MVP rule:



```text

Do not delete files from Availity ReceiveFiles automatically.

```



Reason: Availity already archives ReceiveFiles after 30 days, and keeping files temporarily reduces operational risk. Our duplicate detection prevents reprocessing.



Optional post-MVP rule:



```text

After successful download + storage + parse:

&#x20; move or delete remote file if Availity mailbox policy allows it.

```



\---



\## Duplicate Detection



```sql

CREATE TABLE edi\_remote\_file\_log (

&#x20; id UUID PRIMARY KEY,

&#x20; sftp\_account\_id UUID NOT NULL REFERENCES edi\_sftp\_accounts(id),

&#x20; remote\_folder TEXT NOT NULL,

&#x20; remote\_file\_name TEXT NOT NULL,

&#x20; remote\_file\_size BIGINT,

&#x20; remote\_modified\_at TIMESTAMPTZ,

&#x20; file\_hash TEXT,

&#x20; inbound\_file\_id UUID REFERENCES edi\_inbound\_files(id),

&#x20; first\_seen\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

&#x20; downloaded\_at TIMESTAMPTZ,

&#x20; status TEXT NOT NULL DEFAULT 'SEEN',



&#x20; UNIQUE (sftp\_account\_id, remote\_folder, remote\_file\_name, remote\_file\_size, remote\_modified\_at)

);

```



Duplicate rule:



```text

Primary duplicate check:

&#x20; SHA-256 file hash



Secondary duplicate check:

&#x20; remote filename + size + modified timestamp



X12 duplicate check:

&#x20; ISA13 + GS06 + ST02 where available

```



\---



\## Job Table



```sql

CREATE TABLE edi\_jobs (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID NOT NULL REFERENCES organizations(id),

&#x20; job\_type TEXT NOT NULL, -- UPLOAD, DOWNLOAD, PARSE, REPROCESS

&#x20; related\_batch\_id UUID REFERENCES edi\_batches(id),

&#x20; related\_inbound\_file\_id UUID REFERENCES edi\_inbound\_files(id),

&#x20; status TEXT NOT NULL DEFAULT 'QUEUED',

&#x20; attempt\_count INT NOT NULL DEFAULT 0,

&#x20; next\_attempt\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

&#x20; last\_error TEXT,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

&#x20; completed\_at TIMESTAMPTZ

);

```



\---



\## Operational Safeguards



```text

Connection timeout: 60 seconds

Upload timeout: 10 minutes

Download timeout: 10 minutes

Max parallel uploads per organization: 1

Max parallel downloads per organization: 1

Max parser workers: configurable

Raw file retention: minimum 7 years recommended

Audit log: required for every upload, download, parse, retry, and manual reprocess

```



\## Confirmation



For MVP, I’ll keep remote ReceiveFiles untouched after download and rely on duplicate detection rather than deleting files from Availity.



\## Method — Part 10: Application API + Admin Operations



This section defines the internal API the app needs so users can batch, upload, download, reprocess, and review Availity EDI files.



Availity batch files are uploaded to \*\*SendFiles\*\*, while acknowledgements, reports, responses, and ERA files are downloaded from \*\*ReceiveFiles\*\*. 



\---



\## User-Facing Modules



| Module           | Main Actions                                                   |

| ---------------- | -------------------------------------------------------------- |

| 837P Claims      | Create batch, validate claims, upload, view 999/277/835 status |

| 270 Eligibility  | Create eligibility batch, upload, view 271 response            |

| 276 Claim Status | Create status batch, upload, view 277 response                 |

| 835 ERA          | Download, parse, match, review, approve posting                |

| Inbound Files    | Download, parse, reprocess, mark duplicate                     |

| SFTP Admin       | Test connection, rotate password, view sync status             |



\---



\## API Endpoints



```text id="api-endpoints"

POST   /edi/837p/batches

GET    /edi/837p/batches

GET    /edi/837p/batches/{batchId}

POST   /edi/837p/batches/{batchId}/upload

POST   /edi/837p/batches/{batchId}/rebatch



POST   /edi/270/batches

GET    /edi/270/requests/{requestId}/response



POST   /edi/276/batches

GET    /edi/276/requests/{requestId}/response



POST   /edi/sftp/{organizationId}/test

POST   /edi/sftp/{organizationId}/upload-pending

POST   /edi/sftp/{organizationId}/download-now



GET    /edi/inbound-files

GET    /edi/inbound-files/{fileId}

POST   /edi/inbound-files/{fileId}/reprocess



GET    /edi/era/files

GET    /edi/era/claims/review

POST   /edi/era/claims/{eraClaimId}/approve

POST   /edi/era/claims/{eraClaimId}/reject

```



\---



\## Admin UI Screens



\### 1. EDI Dashboard



Shows:



```text id="dashboard"

pending uploads

recent uploaded batches

new inbound files

999 rejected batches

unmatched 835 claims

failed parser jobs

SFTP connection status by organization

```



\### 2. Batch Detail Page



Shows:



```text id="batch-detail"

batch file name

transaction type

organization

payer

environment

ISA13 / GS06

upload timestamp

raw X12 download

acknowledgement status

linked claims or requests

errors and rejection messages

```



\### 3. Inbound File Detail Page



Shows:



```text id="inbound-detail"

file name

file extension

transaction type

download timestamp

raw file download

parse status

related outbound batch

parsed records

parser errors

manual reprocess button

```



\### 4. ERA Review Queue



Shows:



```text id="era-review"

payer

payment trace number

payment date

claim match status

patient control number

charge amount

paid amount

adjustments

patient responsibility

approve / reject / hold

```



\---



\## API Authorization



```text id="authorization"

Billing Admin:

&#x20; manage SFTP accounts

&#x20; create/upload batches

&#x20; download inbound files

&#x20; reprocess files

&#x20; approve ERA posting



Billing User:

&#x20; create batches

&#x20; view responses

&#x20; review ERA records



Read Only:

&#x20; view batches, files, responses, and audit logs

```



\---



\## Audit Events



```sql id="audit-events"

CREATE TABLE edi\_audit\_events (

&#x20; id UUID PRIMARY KEY,

&#x20; organization\_id UUID REFERENCES organizations(id),

&#x20; actor\_user\_id UUID,

&#x20; event\_type TEXT NOT NULL,

&#x20; entity\_type TEXT NOT NULL,

&#x20; entity\_id UUID,

&#x20; old\_status TEXT,

&#x20; new\_status TEXT,

&#x20; ip\_address TEXT,

&#x20; user\_agent TEXT,

&#x20; notes TEXT,

&#x20; created\_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

```



Required audit events:



```text id="required-audit-events"

BATCH\_CREATED

BATCH\_VALIDATED

BATCH\_UPLOAD\_STARTED

BATCH\_UPLOADED

BATCH\_UPLOAD\_FAILED

INBOUND\_FILE\_DOWNLOADED

INBOUND\_FILE\_PARSED

INBOUND\_FILE\_PARSE\_FAILED

ERA\_APPROVED

ERA\_REJECTED

ERA\_POSTED

SFTP\_CONNECTION\_TESTED

SFTP\_PASSWORD\_ROTATED

```



\---



\## API Flow



```plantuml id="api-flow"

@startuml

actor BillingUser

participant "Web App" as UI

participant "EDI API" as API

participant "Batch Service" as Batch

participant "SFTP Service" as SFTP

participant "Parser Service" as Parser

database "PostgreSQL" as DB

cloud "Object Storage" as Store



BillingUser -> UI : Create 837P / 270 / 276 batch

UI -> API

API -> Batch : validate + generate X12

Batch -> Store : save outbound file

Batch -> DB : create batch records



BillingUser -> UI : Upload batch

UI -> API

API -> SFTP : upload to Availity SendFiles

SFTP -> DB : mark uploaded



BillingUser -> UI : Download responses

UI -> API

API -> SFTP : poll ReceiveFiles

SFTP -> Store : save raw inbound file

SFTP -> Parser : parse 999/835/271/277

Parser -> DB : update records

@enduml

```



\## Next confirmation



I’ll use \*\*REST API + scheduled background workers\*\* for MVP, not event streaming. That keeps the first build simpler while still allowing later migration to queues/events.





Confirmed: MVP will use \*\*REST API + scheduled background workers\*\*, not event streaming.



\## Method — Part 11: REST + Worker Runtime Design



Availity SFTP remains the external transport. Our app handles batching, upload to \*\*SendFiles\*\*, download from \*\*ReceiveFiles\*\*, parsing, review, and audit storage. 



```plantuml id="runtime-design"

@startuml

rectangle "Web App / Admin UI" as UI

rectangle "REST API" as API

rectangle "Background Worker" as Worker

rectangle "Scheduler" as Scheduler

database "PostgreSQL" as DB

cloud "Object Storage" as Storage

cloud "Availity SFTP" as Availity



UI --> API



API --> DB : create batches, requests, reviews

API --> Storage : retrieve raw files



Scheduler --> Worker : enqueue upload/download/parse jobs

Worker --> DB : read queued jobs

Worker --> Storage : read/write raw X12 files

Worker --> Availity : SFTP SendFiles / ReceiveFiles

Worker --> DB : update statuses, parsed records

@enduml

```



\## Worker Types



```text id="worker-types"

837P\_BATCH\_WORKER

270\_BATCH\_WORKER

276\_BATCH\_WORKER

SFTP\_UPLOAD\_WORKER

SFTP\_DOWNLOAD\_WORKER

INBOUND\_PARSE\_WORKER

ERA\_REVIEW\_POSTING\_WORKER

RECONCILIATION\_WORKER

```



\## Recommended MVP Runtime



```text id="runtime-recommendation"

REST API:

&#x20; handles user actions and validation



Scheduler:

&#x20; runs every 15 minutes for upload/download jobs



Worker:

&#x20; performs long-running EDI generation, SFTP, parsing, and retries



Database:

&#x20; PostgreSQL transactional source of truth



Object Storage:

&#x20; stores immutable raw outbound/inbound X12 files

```



\## Job Ownership Rules



```text id="job-ownership"

Only one active upload worker per organization.

Only one active download worker per organization.

Parsing can run in parallel after file download.

837P, 270, and 276 generation must lock selected source records before batching.

```



\## Status Locking Rule



```sql id="job-locking"

UPDATE edi\_jobs

SET status = 'RUNNING',

&#x20;   attempt\_count = attempt\_count + 1

WHERE id = (

&#x20; SELECT id

&#x20; FROM edi\_jobs

&#x20; WHERE status = 'QUEUED'

&#x20;   AND next\_attempt\_at <= now()

&#x20; ORDER BY created\_at

&#x20; FOR UPDATE SKIP LOCKED

&#x20; LIMIT 1

)

RETURNING \*;

```



\## Method — Part 12: Chosen Implementation Stack



I choose this stack for MVP:



| Layer             | Choice                                                  |

| ----------------- | ------------------------------------------------------- |

| Backend API       | \*\*Python FastAPI\*\*                                      |

| Database          | \*\*PostgreSQL 18.x\*\*                                     |

| ORM / migrations  | \*\*SQLAlchemy 2.x + Alembic\*\*                            |

| Workers           | \*\*Celery 5.6.x\*\*                                        |

| Job broker/cache  | \*\*Redis\*\*                                               |

| SFTP              | \*\*Paramiko\*\*                                            |

| Raw file storage  | \*\*S3-compatible object storage\*\*                        |

| Frontend/admin UI | \*\*React + TypeScript\*\*                                  |

| Deployment        | \*\*Docker containers\*\*                                   |

| Hosting           | AWS, Azure, GCP, or HIPAA-capable VPS/cloud environment |



FastAPI is well-suited for typed REST APIs, SQLAlchemy 2.0 is the current major ORM line, Celery 5.6 is the current stable task-queue line, and Paramiko provides Python SFTP client support through `SFTPClient`. PostgreSQL 18 is the current PostgreSQL documentation line, and MinIO’s Python SDK supports S3-compatible object storage, which lets us use AWS S3 in production and local MinIO in development. (\[FastAPI]\[1])



\---



\## Why This Stack



```text

FastAPI:

&#x20; REST API for batching, upload, download, review, and admin workflows.



PostgreSQL:

&#x20; Source of truth for claims, batches, control numbers, parsed responses, audit logs.



Celery + Redis:

&#x20; Background workers for SFTP upload/download, parsing, retries, and reconciliation.



Paramiko:

&#x20; SFTP connection to Availity SendFiles and ReceiveFiles.



S3-compatible storage:

&#x20; Immutable storage for every outbound and inbound X12 file.



React + TypeScript:

&#x20; Admin dashboard, ERA review queue, batch details, parser errors, and reprocessing screens.

```



Availity remains the external transport endpoint: outbound files go to \*\*SendFiles\*\*, inbound responses are retrieved from \*\*ReceiveFiles\*\*, and we store our own permanent copies because Availity archives/removes files on its own schedule. 



\---



\## Version Pinning Rule



```text

Do not use floating dependency versions in production.



Use:

&#x20; pyproject.toml

&#x20; uv.lock or poetry.lock

&#x20; Docker image digests

&#x20; explicit PostgreSQL major version

```



FastAPI is still in the `0.x.x` version range, and its documentation notes that breaking changes are still possible, so the implementation must pin exact versions and upgrade intentionally. (\[FastAPI]\[2])



\---



\## MVP Service Layout



```text

services/

&#x20; api/

&#x20;   FastAPI REST API



&#x20; worker/

&#x20;   Celery workers:

&#x20;     - batch generation

&#x20;     - SFTP upload

&#x20;     - SFTP download

&#x20;     - inbound parsing

&#x20;     - ERA review posting



&#x20; scheduler/

&#x20;   Celery beat or scheduler process



&#x20; web/

&#x20;   React admin UI



&#x20; db/

&#x20;   PostgreSQL



&#x20; redis/

&#x20;   Celery broker/cache



&#x20; object-storage/

&#x20;   S3 bucket or MinIO-compatible bucket

```



\---



\## Implementation Choice Locked



We will proceed with:



```text

Python FastAPI

PostgreSQL

SQLAlchemy + Alembic

Celery + Redis

Paramiko SFTP

S3-compatible raw file storage

React + TypeScript admin UI

```



N## Implementation — Contractor-Ready Build Plan



The MVP will use \*\*FastAPI + PostgreSQL + SQLAlchemy/Alembic + Celery/Redis + Paramiko SFTP + S3-compatible storage + React/TypeScript\*\*. FastAPI should be pinned because its docs note that `0.x.x` versions can include breaking changes; SQLAlchemy’s current docs are for the 2.0 line; Celery’s docs list 5.6 as the current stable line; Paramiko’s `SFTPClient` supports remote file operations for upload/download. (\[FastAPI]\[1])



Availity-specific implementation must follow the guide’s SFTP model: upload outbound files to \*\*SendFiles\*\*, download responses from \*\*ReceiveFiles\*\*, use QA/production environments, and persist downloaded files internally because Availity archives/removes files on its own schedule. 



\---



\# Implementation



\## Phase 1 — Project Foundation



Create the repository structure:



```text

edi-platform/

&#x20; api/

&#x20;   app/

&#x20;     main.py

&#x20;     settings.py

&#x20;     database.py

&#x20;     auth/

&#x20;     edi/

&#x20;       models/

&#x20;       schemas/

&#x20;       services/

&#x20;       parsers/

&#x20;       generators/

&#x20;       sftp/

&#x20;       workers/

&#x20;     claims/

&#x20;     eligibility/

&#x20;     remittance/

&#x20;   alembic/

&#x20;   pyproject.toml



&#x20; web/

&#x20;   src/

&#x20;     pages/

&#x20;     components/

&#x20;     api/

&#x20;     routes/



&#x20; docker/

&#x20;   Dockerfile.api

&#x20;   Dockerfile.worker

&#x20;   docker-compose.yml

```



Deliverables:



```text

FastAPI app boots successfully

PostgreSQL connection works

Alembic migrations run

Redis/Celery worker starts

S3/MinIO bucket connection works

Healthcheck endpoint exists

```



\---



\## Phase 2 — Database + Seed Data



Implement the schema already defined for:



```text

organizations

clinicians

payers

claims

claim\_service\_lines

eligibility\_requests

claim\_status\_requests

edi\_batches

edi\_batch\_items

edi\_inbound\_files

edi\_acknowledgements

edi\_sftp\_accounts

edi\_jobs

edi\_audit\_events

era\_files

era\_claims

era\_adjustments

eligibility\_responses

claim\_status\_responses

```



Seed the two organizations:



```text

Conscious Counseling PLLC

&#x20; TIN: 861384084

&#x20; Billing NPI: 1982355160

&#x20; Availity Submitter ID: 1082546

&#x20; Default 837P rendering provider: Lyndsey Klemme, NPI 1629632542



Kindly Kiera LLC

&#x20; TIN: 851383748

&#x20; Billing NPI: 1770242786

&#x20; Availity Submitter ID: 1062487

&#x20; Default 837P rendering provider: Kiera Rommel, NPI 1922499581

```



Seed eligibility default:



```text

270 service type code = 98

```



Acceptance criteria:



```text

Conscious Counseling claims always resolve Lyndsey Klemme as rendering provider

Kindly Kiera claims resolve Kiera Rommel as rendering provider

SSNs are encrypted or omitted

TINs are normalized to 9 digits

NPIs are validated as 10 digits

```



\---



\## Phase 3 — X12 Core Library



Build reusable X12 helpers:



```text

Segment builder

Envelope builder

Control number generator

Delimiter configuration

Segment counter

File size estimator

X12 tokenizer/parser

Validation error collector

```



Default delimiters:



```text

Element separator: \*

Component separator: :

Segment terminator: \~

Repetition separator: ^

```



Control numbers must be unique for:



```text

ISA13

GS06

ST02

```



Acceptance criteria:



```text

Generated files have valid ISA/IEA, GS/GE, ST/SE pairs

SE segment count is correct

Duplicate ISA13 is blocked

QA files use ISA15 = T

Production files use ISA15 = P

```



\---



\## Phase 4 — 837P Generator



Build the outbound \*\*837P only\*\* generator for `005010X222A1`.



Batch grouping:



```text

organization + payer + environment

```



Batch split rules:



```text

maximum 5,000 claims

or approximately 4 MB optimal file size

```



Provider rules:



```text

Billing provider = organization Type 2 NPI

Rendering provider = organization default rendering provider

```



Conscious Counseling hard rule:



```text

Always emit Lyndsey Klemme / NPI 1629632542 as rendering provider

```



Acceptance criteria:



```text

837P file can be generated from database claims

Dependent patient scenarios are supported

Claims missing payer, subscriber, diagnosis, CPT, service date, charge, or provider data fail pre-batch validation

Generated file is stored in object storage

edi\_batches and edi\_batch\_items records are created

```



\---



\## Phase 5 — 270 Eligibility Generator



Build the outbound \*\*270\*\* generator for `005010X279A1`.



Default request:



```text

EQ\*98\~

```



Batch grouping:



```text

organization + payer + environment

```



Acceptance criteria:



```text

270 file is generated from eligibility\_requests

Default service type code is 98

Generated file is uploaded-ready

Request status moves from READY\_FOR\_BATCH to BATCH\_CREATED

```



\---



\## Phase 6 — 276 Claim Status Generator



Build the outbound \*\*276\*\* generator for `005010X212`.



Generation rule:



```text

Only generate 276 after the claim has passed Availity acknowledgement stage.

```



Allowed source claim statuses:



```text

999\_ACCEPTED

AVAILITY\_ACCEPTED

PAYER\_PENDING

SUBMITTED\_TO\_PAYER

```



Acceptance criteria:



```text

276 cannot be created for claims rejected by validation, upload, TA1, ACK, or 999

276 uses payer claim control number when available

Otherwise it uses original patient control number

```



\---



\## Phase 7 — SFTP Upload/Download



Implement Paramiko-based SFTP connector.



Jobs:



```text

upload\_pending\_batches

download\_receive\_files

test\_sftp\_connection

```



Folders:



```text

Upload: SendFiles

Download: ReceiveFiles

```



Retry policy:



```text

Immediate

+5 minutes

+15 minutes

+30 minutes

+60 minutes

Then manual review

```



Acceptance criteria:



```text

Each organization uses its own Availity SFTP account

QA connects to qa-files.availity.com

Production connects to files.availity.com

Upload marks batch UPLOADED\_TO\_AVAILITY

Download stores raw inbound file before parsing

Duplicate file hash is not parsed twice

Remote ReceiveFiles are not deleted in MVP

```



\---



\## Phase 8 — Inbound Parsers



Build parser router for:



```text

999

835

271

277

ACK / TA1 where present

```



Parser routing should use:



```text

file extension

ST01 transaction code

content inspection fallback

```



\### 999 Parser



Updates:



```text

edi\_batches

edi\_acknowledgements

edi\_999\_results

edi\_999\_errors

```



Acceptance criteria:



```text

Accepted 999 moves batch to 999\_ACCEPTED

Rejected 999 moves batch to 999\_REJECTED

Errors are visible in admin UI

```



\### 835 Parser



Stores ERA data but does \*\*not\*\* auto-post.



Acceptance criteria:



```text

BPR/TRN payment data is stored

CLP claim payments are stored

CAS adjustments are stored

Matched claims go to MATCHED\_PENDING\_REVIEW

Unmatched claims go to UNMATCHED

No claim balance is updated until user approval

```



\### 271 Parser



Acceptance criteria:



```text

271 links back to original 270 when possible

Eligibility response is marked ACTIVE, INACTIVE, ERROR, or MANUAL\_REVIEW\_REQUIRED

```



\### 277 Parser



Acceptance criteria:



```text

277 links back to original 276 when possible

Claim status category/code/message is stored

Claim external status fields are updated when matched

Unmatched responses go to manual review

```



\---



\## Phase 9 — Admin UI



Build React screens:



```text

EDI Dashboard

837P Batch List

Batch Detail

Inbound Files

Parser Errors

Eligibility Requests / 271 Results

Claim Status Requests / 277 Results

ERA Review Queue

SFTP Settings

Audit Log

```



Required user actions:



```text

Create 837P batch

Create 270 batch

Create 276 batch

Upload batch

Download inbound files now

View raw X12

Reprocess inbound file

Approve ERA claim posting

Reject ERA claim posting

Test SFTP connection

```



\---



\## Phase 10 — Security + Compliance



Implement:



```text

PHI encryption at rest

TLS for app traffic

SFTP credential encryption

Object storage private buckets

Role-based access control

Audit logging

No SSNs in logs

No raw X12 in application logs

File download access checks

7-year raw file retention policy

```



Roles:



```text

Billing Admin

Billing User

Read Only

```



\---



\## Phase 11 — QA Testing With Availity



Testing sequence:



```text

1\. Configure QA SFTP account for each organization.

2\. Generate test 837P with ISA15 = T.

3\. Upload to Availity QA SendFiles.

4\. Download 999/ACK response from ReceiveFiles.

5\. Fix validation errors.

6\. Repeat for 270 and 276.

7\. Confirm parser behavior.

8\. Move to production only after successful QA.

```



Acceptance criteria:



```text

837P test file receives parsable acknowledgement

270 test file receives parsable 271 or acknowledgement

276 test file receives parsable 277 or acknowledgement

No duplicate files are created or parsed

All raw files are retained internally

```



\---



\## Phase 12 — Production Rollout



Production checklist:



```text

Production SFTP credentials entered for each organization

ISA15 switched to P

Payer IDs verified

Enrollment requirements verified

Reporting preferences configured in Availity

835 ERA delivery confirmed

Positive 999 preference enabled if desired

Monitoring alerts enabled

Nightly reconciliation enabled

```



Deployment acceptance:



```text

Users can batch 837P claims

Users can upload via SFTP

System downloads Availity responses

999 results update batch status

835 files enter review queue

271/277 responses update source requests

Audit trail is complete

```



Next I’ll write the \*\*Milestones\*\* section with estimated contractor work packages and acceptance checkpoints.



\[1]: https://fastapi.tiangolo.com/deployment/versions/?utm\_source=chatgpt.com "About FastAPI versions"





\# pyproject.toml

\[project]

name = "edi-platform"

version = "0.1.0"

description = "Availity EDI MVP"

requires-python = ">=3.12"

dependencies = \[

&#x20; "fastapi==0.115.12",

&#x20; "uvicorn\[standard]==0.34.2",

&#x20; "pydantic==2.11.5",

&#x20; "pydantic-settings==2.9.1",

&#x20; "sqlalchemy==2.0.41",

&#x20; "psycopg\[binary]==3.2.9",

&#x20; "alembic==1.16.1",

&#x20; "celery==5.5.3",

&#x20; "redis==6.2.0",

&#x20; "paramiko==3.5.1",

&#x20; "python-multipart==0.0.20"

]



\[build-system]

requires = \["setuptools>=68", "wheel"]

build-backend = "setuptools.build\_meta"





\# docker-compose.yml

version: "3.9"



services:

&#x20; db:

&#x20;   image: postgres:18

&#x20;   environment:

&#x20;     POSTGRES\_DB: edi

&#x20;     POSTGRES\_USER: edi

&#x20;     POSTGRES\_PASSWORD: edi

&#x20;   ports:

&#x20;     - "5432:5432"

&#x20;   volumes:

&#x20;     - postgres\_data:/var/lib/postgresql/data



&#x20; redis:

&#x20;   image: redis:7

&#x20;   ports:

&#x20;     - "6379:6379"



&#x20; api:

&#x20;   image: python:3.12-slim

&#x20;   working\_dir: /app

&#x20;   volumes:

&#x20;     - ./:/app

&#x20;   command: bash -lc "pip install -e . \&\& uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

&#x20;   environment:

&#x20;     APP\_ENV: local

&#x20;     DATABASE\_URL: postgresql+psycopg://edi:edi@db:5432/edi

&#x20;     REDIS\_URL: redis://redis:6379/0

&#x20;     API\_HOST: 0.0.0.0

&#x20;     API\_PORT: 8000

&#x20;     X12\_RECEIVER\_ID: 030240928

&#x20;     X12\_INTERCHANGE\_RECEIVER\_ID: 030240928

&#x20;     X12\_INTERCHANGE\_SENDER\_QUALIFIER: ZZ

&#x20;     X12\_INTERCHANGE\_RECEIVER\_QUALIFIER: 01

&#x20;     X12\_INTERCHANGE\_SENDER\_ID: AV09311993

&#x20;   ports:

&#x20;     - "8000:8000"

&#x20;   depends\_on:

&#x20;     - db

&#x20;     - redis



&#x20; worker:

&#x20;   image: python:3.12-slim

&#x20;   working\_dir: /app

&#x20;   volumes:

&#x20;     - ./:/app

&#x20;   command: bash -lc "pip install -e . \&\& celery -A app.worker.celery\_app worker --loglevel=info"

&#x20;   environment:

&#x20;     APP\_ENV: local

&#x20;     DATABASE\_URL: postgresql+psycopg://edi:edi@db:5432/edi

&#x20;     REDIS\_URL: redis://redis:6379/0

&#x20;     X12\_RECEIVER\_ID: 030240928

&#x20;     X12\_INTERCHANGE\_RECEIVER\_ID: 030240928

&#x20;     X12\_INTERCHANGE\_SENDER\_QUALIFIER: ZZ

&#x20;     X12\_INTERCHANGE\_RECEIVER\_QUALIFIER: 01

&#x20;     X12\_INTERCHANGE\_SENDER\_ID: AV09311993

&#x20;   depends\_on:

&#x20;     - db

&#x20;     - redis



volumes:

&#x20; postgres\_data:





\# app/\_\_init\_\_.py





\# app/main.py

from fastapi import FastAPI



from app.api.routes.health import router as health\_router

from app.api.routes.edi\_837p import router as edi\_837p\_router

from app.database import Base, engine



app = FastAPI(title="EDI Platform", version="0.1.0")



Base.metadata.create\_all(bind=engine)



app.include\_router(health\_router, prefix="/health", tags=\["health"])

app.include\_router(edi\_837p\_router, prefix="/edi/837p", tags=\["edi-837p"])





\# app/settings.py

from functools import lru\_cache

from pydantic import Field

from pydantic\_settings import BaseSettings, SettingsConfigDict





class Settings(BaseSettings):

&#x20;   model\_config = SettingsConfigDict(case\_sensitive=False, extra="ignore")



&#x20;   app\_env: str = Field(default="local", alias="APP\_ENV")

&#x20;   api\_host: str = Field(default="0.0.0.0", alias="API\_HOST")

&#x20;   api\_port: int = Field(default=8000, alias="API\_PORT")



&#x20;   database\_url: str = Field(

&#x20;       default="postgresql+psycopg://edi:edi@localhost:5432/edi",

&#x20;       alias="DATABASE\_URL",

&#x20;   )

&#x20;   redis\_url: str = Field(default="redis://localhost:6379/0", alias="REDIS\_URL")



&#x20;   x12\_receiver\_id: str = Field(default="030240928", alias="X12\_RECEIVER\_ID")

&#x20;   x12\_interchange\_sender\_qualifier: str = Field(

&#x20;       default="ZZ",

&#x20;       alias="X12\_INTERCHANGE\_SENDER\_QUALIFIER",

&#x20;   )

&#x20;   x12\_interchange\_sender\_id: str = Field(

&#x20;       default="AV09311993",

&#x20;       alias="X12\_INTERCHANGE\_SENDER\_ID",

&#x20;   )

&#x20;   x12\_interchange\_receiver\_qualifier: str = Field(

&#x20;       default="01",

&#x20;       alias="X12\_INTERCHANGE\_RECEIVER\_QUALIFIER",

&#x20;   )

&#x20;   x12\_interchange\_receiver\_id: str = Field(

&#x20;       default="030240928",

&#x20;       alias="X12\_INTERCHANGE\_RECEIVER\_ID",

&#x20;   )



&#x20;   x12\_element\_separator: str = "\*"

&#x20;   x12\_component\_separator: str = ":"

&#x20;   x12\_segment\_terminator: str = "\~"

&#x20;   x12\_repetition\_separator: str = "^"





@lru\_cache

def get\_settings() -> Settings:

&#x20;   return Settings()





\# app/database.py

from sqlalchemy import create\_engine

from sqlalchemy.orm import DeclarativeBase, sessionmaker



from app.settings import get\_settings



settings = get\_settings()



engine = create\_engine(settings.database\_url, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)





class Base(DeclarativeBase):

&#x20;   pass





def get\_db():

&#x20;   db = SessionLocal()

&#x20;   try:

&#x20;       yield db

&#x20;   finally:

&#x20;       db.close()





\# app/api/routes/health.py

from fastapi import APIRouter



router = APIRouter()





@router.get("")

def healthcheck() -> dict\[str, str]:

&#x20;   return {"status": "ok"}





\# app/api/routes/edi\_837p.py

from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session



from app.database import get\_db

from app.schemas.edi\_837p import CreateBatchRequest, CreateBatchResponse

from app.services.batch\_837p import create\_837p\_batch



router = APIRouter()





@router.post("/batches", response\_model=CreateBatchResponse)

def create\_batch(payload: CreateBatchRequest, db: Session = Depends(get\_db)) -> CreateBatchResponse:

&#x20;   result = create\_837p\_batch(

&#x20;       db=db,

&#x20;       organization\_id=payload.organization\_id,

&#x20;       payer\_id=payload.payer\_id,

&#x20;       environment=payload.environment,

&#x20;       claim\_ids=payload.claim\_ids,

&#x20;   )

&#x20;   if not result:

&#x20;       raise HTTPException(status\_code=400, detail="No valid claims found for batch creation")

&#x20;   return result





\# app/models/\_\_init\_\_.py

from app.models.claim import Claim, ClaimServiceLine

from app.models.clinician import Clinician

from app.models.edi\_batch import EdiBatch, EdiBatchItem

from app.models.organization import Organization

from app.models.payer import Payer



\_\_all\_\_ = \[

&#x20;   "Claim",

&#x20;   "ClaimServiceLine",

&#x20;   "Clinician",

&#x20;   "EdiBatch",

&#x20;   "EdiBatchItem",

&#x20;   "Organization",

&#x20;   "Payer",

]





\# app/models/organization.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import Boolean, DateTime, ForeignKey, String

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column, relationship



from app.database import Base





class Organization(Base):

&#x20;   \_\_tablename\_\_ = "organizations"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   legal\_name: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   tin\_normalized: Mapped\[str] = mapped\_column(String(9), nullable=False)

&#x20;   billing\_npi: Mapped\[str] = mapped\_column(String(10), nullable=False)

&#x20;   phone: Mapped\[str] = mapped\_column(String(25), nullable=False)

&#x20;   address\_line1: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   address\_line2: Mapped\[str | None] = mapped\_column(String(255), nullable=True)

&#x20;   city: Mapped\[str] = mapped\_column(String(120), nullable=False)

&#x20;   state: Mapped\[str] = mapped\_column(String(2), nullable=False)

&#x20;   postal\_code: Mapped\[str] = mapped\_column(String(15), nullable=False)

&#x20;   availity\_submitter\_id: Mapped\[str] = mapped\_column(String(50), nullable=False)

&#x20;   default\_rendering\_clinician\_id: Mapped\[uuid.UUID | None] = mapped\_column(

&#x20;       UUID(as\_uuid=True),

&#x20;       ForeignKey("clinicians.id"),

&#x20;       nullable=True,

&#x20;   )

&#x20;   is\_active: Mapped\[bool] = mapped\_column(Boolean, default=True, nullable=False)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )



&#x20;   clinicians: Mapped\[list\["Clinician"]] = relationship(

&#x20;       "Clinician",

&#x20;       back\_populates="organization",

&#x20;       foreign\_keys="Clinician.organization\_id",

&#x20;   )





\# app/models/clinician.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import Boolean, DateTime, ForeignKey, String

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column, relationship



from app.database import Base





class Clinician(Base):

&#x20;   \_\_tablename\_\_ = "clinicians"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(

&#x20;       UUID(as\_uuid=True),

&#x20;       ForeignKey("organizations.id"),

&#x20;       nullable=False,

&#x20;   )

&#x20;   full\_name: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   credential\_text: Mapped\[str | None] = mapped\_column(String(255), nullable=True)

&#x20;   rendering\_npi: Mapped\[str] = mapped\_column(String(10), nullable=False)

&#x20;   email: Mapped\[str | None] = mapped\_column(String(255), nullable=True)

&#x20;   is\_active: Mapped\[bool] = mapped\_column(Boolean, default=True, nullable=False)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )



&#x20;   organization: Mapped\["Organization"] = relationship(

&#x20;       "Organization",

&#x20;       back\_populates="clinicians",

&#x20;       foreign\_keys=\[organization\_id],

&#x20;   )





\# app/models/payer.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import Boolean, DateTime, String

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column



from app.database import Base





class Payer(Base):

&#x20;   \_\_tablename\_\_ = "payers"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   payer\_name: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   payer\_id: Mapped\[str] = mapped\_column(String(80), nullable=False)

&#x20;   availity\_enabled: Mapped\[bool] = mapped\_column(Boolean, default=True, nullable=False)

&#x20;   supports\_837p: Mapped\[bool] = mapped\_column(Boolean, default=True, nullable=False)

&#x20;   is\_active: Mapped\[bool] = mapped\_column(Boolean, default=True, nullable=False)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )





\# app/models/claim.py

import uuid

from datetime import date, datetime, timezone

from decimal import Decimal



from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column, relationship



from app.database import Base





class Claim(Base):

&#x20;   \_\_tablename\_\_ = "claims"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("organizations.id"), nullable=False)

&#x20;   payer\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("payers.id"), nullable=False)

&#x20;   patient\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), nullable=False)

&#x20;   service\_clinician\_id: Mapped\[uuid.UUID | None] = mapped\_column(UUID(as\_uuid=True), ForeignKey("clinicians.id"), nullable=True)

&#x20;   edi\_rendering\_clinician\_id: Mapped\[uuid.UUID | None] = mapped\_column(UUID(as\_uuid=True), ForeignKey("clinicians.id"), nullable=True)



&#x20;   claim\_control\_number: Mapped\[str] = mapped\_column(String(80), nullable=False)

&#x20;   patient\_control\_number: Mapped\[str] = mapped\_column(String(80), nullable=False)

&#x20;   total\_charge\_amount: Mapped\[Decimal] = mapped\_column(Numeric(12, 2), nullable=False)



&#x20;   subscriber\_first\_name: Mapped\[str] = mapped\_column(String(120), nullable=False)

&#x20;   subscriber\_last\_name: Mapped\[str] = mapped\_column(String(120), nullable=False)

&#x20;   subscriber\_member\_id: Mapped\[str] = mapped\_column(String(120), nullable=False)

&#x20;   subscriber\_dob: Mapped\[date] = mapped\_column(Date, nullable=False)

&#x20;   subscriber\_gender: Mapped\[str] = mapped\_column(String(1), nullable=False)

&#x20;   subscriber\_address\_line1: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   subscriber\_city: Mapped\[str] = mapped\_column(String(120), nullable=False)

&#x20;   subscriber\_state: Mapped\[str] = mapped\_column(String(2), nullable=False)

&#x20;   subscriber\_postal\_code: Mapped\[str] = mapped\_column(String(15), nullable=False)



&#x20;   patient\_is\_subscriber: Mapped\[str] = mapped\_column(String(1), nullable=False, default="Y")

&#x20;   patient\_first\_name: Mapped\[str | None] = mapped\_column(String(120), nullable=True)

&#x20;   patient\_last\_name: Mapped\[str | None] = mapped\_column(String(120), nullable=True)

&#x20;   patient\_dob: Mapped\[date | None] = mapped\_column(Date, nullable=True)

&#x20;   patient\_gender: Mapped\[str | None] = mapped\_column(String(1), nullable=True)



&#x20;   place\_of\_service\_code: Mapped\[str] = mapped\_column(String(2), nullable=False)

&#x20;   diagnosis\_code\_1: Mapped\[str] = mapped\_column(String(12), nullable=False)

&#x20;   diagnosis\_code\_2: Mapped\[str | None] = mapped\_column(String(12), nullable=True)

&#x20;   diagnosis\_code\_3: Mapped\[str | None] = mapped\_column(String(12), nullable=True)

&#x20;   diagnosis\_code\_4: Mapped\[str | None] = mapped\_column(String(12), nullable=True)



&#x20;   status: Mapped\[str] = mapped\_column(String(50), nullable=False, default="READY\_FOR\_BATCH")

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )



&#x20;   service\_lines: Mapped\[list\["ClaimServiceLine"]] = relationship(

&#x20;       "ClaimServiceLine",

&#x20;       back\_populates="claim",

&#x20;       cascade="all, delete-orphan",

&#x20;   )





class ClaimServiceLine(Base):

&#x20;   \_\_tablename\_\_ = "claim\_service\_lines"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   claim\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("claims.id"), nullable=False)

&#x20;   line\_number: Mapped\[int] = mapped\_column(Integer, nullable=False)

&#x20;   service\_date: Mapped\[date] = mapped\_column(Date, nullable=False)

&#x20;   cpt\_code: Mapped\[str] = mapped\_column(String(10), nullable=False)

&#x20;   modifier\_1: Mapped\[str | None] = mapped\_column(String(2), nullable=True)

&#x20;   modifier\_2: Mapped\[str | None] = mapped\_column(String(2), nullable=True)

&#x20;   modifier\_3: Mapped\[str | None] = mapped\_column(String(2), nullable=True)

&#x20;   modifier\_4: Mapped\[str | None] = mapped\_column(String(2), nullable=True)

&#x20;   charge\_amount: Mapped\[Decimal] = mapped\_column(Numeric(12, 2), nullable=False)

&#x20;   units: Mapped\[Decimal] = mapped\_column(Numeric(8, 2), nullable=False, default=1)

&#x20;   diagnosis\_pointer: Mapped\[str] = mapped\_column(String(10), nullable=False, default="1")



&#x20;   claim: Mapped\["Claim"] = relationship("Claim", back\_populates="service\_lines")





\# app/models/edi\_batch.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column



from app.database import Base





class EdiBatch(Base):

&#x20;   \_\_tablename\_\_ = "edi\_batches"

&#x20;   \_\_table\_args\_\_ = (

&#x20;       UniqueConstraint("environment", "isa\_control\_number", name="uq\_edi\_batches\_env\_isa"),

&#x20;   )



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("organizations.id"), nullable=False)

&#x20;   transaction\_type: Mapped\[str] = mapped\_column(String(20), nullable=False)

&#x20;   environment: Mapped\[str] = mapped\_column(String(10), nullable=False)

&#x20;   isa\_control\_number: Mapped\[str] = mapped\_column(String(20), nullable=False)

&#x20;   gs\_control\_number: Mapped\[str] = mapped\_column(String(20), nullable=False)

&#x20;   file\_name: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   file\_hash: Mapped\[str] = mapped\_column(String(64), nullable=False)

&#x20;   raw\_x12: Mapped\[str] = mapped\_column(String, nullable=False)

&#x20;   status: Mapped\[str] = mapped\_column(String(50), nullable=False, default="CREATED")

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )





class EdiBatchItem(Base):

&#x20;   \_\_tablename\_\_ = "edi\_batch\_items"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   batch\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("edi\_batches.id"), nullable=False)

&#x20;   source\_table: Mapped\[str] = mapped\_column(String(50), nullable=False)

&#x20;   source\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), nullable=False)

&#x20;   st\_control\_number: Mapped\[str] = mapped\_column(String(20), nullable=False)

&#x20;   status: Mapped\[str] = mapped\_column(String(50), nullable=False, default="IN\_BATCH")





\# app/schemas/edi\_837p.py

import uuid

from typing import Literal



from pydantic import BaseModel





class CreateBatchRequest(BaseModel):

&#x20;   organization\_id: uuid.UUID

&#x20;   payer\_id: uuid.UUID

&#x20;   environment: Literal\["QA", "PROD"]

&#x20;   claim\_ids: list\[uuid.UUID]





class CreateBatchResponse(BaseModel):

&#x20;   batch\_id: uuid.UUID

&#x20;   file\_name: str

&#x20;   claim\_count: int

&#x20;   status: str

&#x20;   isa\_control\_number: str

&#x20;   gs\_control\_number: str





\# app/x12/types.py

from dataclasses import dataclass





@dataclass(frozen=True)

class X12Delimiters:

&#x20;   element\_separator: str = "\*"

&#x20;   component\_separator: str = ":"

&#x20;   segment\_terminator: str = "\~"

&#x20;   repetition\_separator: str = "^"





\# app/x12/builder.py

from collections.abc import Iterable



from app.x12.types import X12Delimiters





def sanitize\_x12\_value(value: object) -> str:

&#x20;   if value is None:

&#x20;       return ""

&#x20;   return str(value).replace("\*", " ").replace("\~", " ").replace(":", " ").strip()





def build\_segment(name: str, elements: Iterable\[object], delimiters: X12Delimiters) -> str:

&#x20;   rendered = \[name, \*\[sanitize\_x12\_value(v) for v in elements]]

&#x20;   return delimiters.element\_separator.join(rendered) + delimiters.segment\_terminator





def count\_segments(x12\_text: str, segment\_terminator: str = "\~") -> int:

&#x20;   return sum(1 for part in x12\_text.split(segment\_terminator) if part.strip())





\# app/x12/control\_numbers.py

from datetime import datetime, timezone



from sqlalchemy import select

from sqlalchemy.orm import Session



from app.models.edi\_batch import EdiBatch





def next\_numeric\_control\_number(db: Session, environment: str) -> str:

&#x20;   latest = db.execute(

&#x20;       select(EdiBatch.isa\_control\_number)

&#x20;       .where(EdiBatch.environment == environment)

&#x20;       .order\_by(EdiBatch.created\_at.desc())

&#x20;       .limit(1)

&#x20;   ).scalar\_one\_or\_none()



&#x20;   if latest and latest.isdigit():

&#x20;       value = int(latest) + 1

&#x20;   else:

&#x20;       value = int(datetime.now(timezone.utc).strftime("%H%M%S"))



&#x20;   return str(value).zfill(9)





\# app/x12/envelope.py

from datetime import datetime



from app.settings import get\_settings

from app.x12.builder import build\_segment

from app.x12.types import X12Delimiters





def fixed\_width(value: str, width: int) -> str:

&#x20;   return value\[:width].ljust(width)





def build\_isa\_segment(

&#x20;   submitter\_id: str,

&#x20;   isa\_control\_number: str,

&#x20;   usage\_indicator: str,

&#x20;   now: datetime,

&#x20;   delimiters: X12Delimiters,

) -> str:

&#x20;   settings = get\_settings()



&#x20;   return build\_segment(

&#x20;       "ISA",

&#x20;       \[

&#x20;           "00",

&#x20;           fixed\_width("", 10),

&#x20;           "00",

&#x20;           fixed\_width("", 10),

&#x20;           settings.x12\_interchange\_sender\_qualifier,

&#x20;           fixed\_width(settings.x12\_interchange\_sender\_id, 15),

&#x20;           settings.x12\_interchange\_receiver\_qualifier,

&#x20;           fixed\_width(settings.x12\_interchange\_receiver\_id, 15),

&#x20;           now.strftime("%y%m%d"),

&#x20;           now.strftime("%H%M"),

&#x20;           delimiters.repetition\_separator,

&#x20;           "00501",

&#x20;           isa\_control\_number.zfill(9),

&#x20;           "1",

&#x20;           usage\_indicator,

&#x20;           delimiters.component\_separator,

&#x20;       ],

&#x20;       delimiters,

&#x20;   )





def build\_iea\_segment(isa\_control\_number: str, delimiters: X12Delimiters) -> str:

&#x20;   return build\_segment("IEA", \[1, isa\_control\_number.zfill(9)], delimiters)





\# app/services/claim\_validation.py

from app.models.claim import Claim





REQUIRED\_CLAIM\_STATUSES = {"READY\_FOR\_BATCH"}





def validate\_claim\_for\_837p(claim: Claim) -> list\[str]:

&#x20;   errors: list\[str] = \[]



&#x20;   if claim.status not in REQUIRED\_CLAIM\_STATUSES:

&#x20;       errors.append(f"Claim {claim.id}: invalid status {claim.status}")



&#x20;   required\_values = {

&#x20;       "claim\_control\_number": claim.claim\_control\_number,

&#x20;       "patient\_control\_number": claim.patient\_control\_number,

&#x20;       "subscriber\_first\_name": claim.subscriber\_first\_name,

&#x20;       "subscriber\_last\_name": claim.subscriber\_last\_name,

&#x20;       "subscriber\_member\_id": claim.subscriber\_member\_id,

&#x20;       "place\_of\_service\_code": claim.place\_of\_service\_code,

&#x20;       "diagnosis\_code\_1": claim.diagnosis\_code\_1,

&#x20;   }



&#x20;   for field\_name, value in required\_values.items():

&#x20;       if value in (None, ""):

&#x20;           errors.append(f"Claim {claim.id}: missing {field\_name}")



&#x20;   if not claim.service\_lines:

&#x20;       errors.append(f"Claim {claim.id}: missing service lines")



&#x20;   for line in claim.service\_lines:

&#x20;       if not line.cpt\_code:

&#x20;           errors.append(f"Claim {claim.id}: line {line.line\_number} missing cpt\_code")

&#x20;       if line.charge\_amount is None:

&#x20;           errors.append(f"Claim {claim.id}: line {line.line\_number} missing charge\_amount")

&#x20;       if line.service\_date is None:

&#x20;           errors.append(f"Claim {claim.id}: line {line.line\_number} missing service\_date")



&#x20;   return errors





\# app/services/provider\_rules.py

from sqlalchemy.orm import Session



from app.models.clinician import Clinician

from app.models.organization import Organization





CONSCIOUS\_COUNSELING = "Conscious Counseling PLLC"

KINDLY\_KIERA = "Kindly Kiera LLC"

CONSCIOUS\_RENDERING\_NPI = "1629632542"

KINDLY\_RENDERING\_NPI = "1922499581"





def resolve\_rendering\_clinician(db: Session, organization: Organization) -> Clinician:

&#x20;   if organization.legal\_name == CONSCIOUS\_COUNSELING:

&#x20;       clinician = (

&#x20;           db.query(Clinician)

&#x20;           .filter(

&#x20;               Clinician.organization\_id == organization.id,

&#x20;               Clinician.rendering\_npi == CONSCIOUS\_RENDERING\_NPI,

&#x20;           )

&#x20;           .one()

&#x20;       )

&#x20;       return clinician



&#x20;   if organization.legal\_name == KINDLY\_KIERA:

&#x20;       clinician = (

&#x20;           db.query(Clinician)

&#x20;           .filter(

&#x20;               Clinician.organization\_id == organization.id,

&#x20;               Clinician.rendering\_npi == KINDLY\_RENDERING\_NPI,

&#x20;           )

&#x20;           .one()

&#x20;       )

&#x20;       return clinician



&#x20;   if organization.default\_rendering\_clinician\_id is None:

&#x20;       raise ValueError(f"Organization {organization.legal\_name} has no default rendering clinician")



&#x20;   clinician = (

&#x20;       db.query(Clinician)

&#x20;       .filter(Clinician.id == organization.default\_rendering\_clinician\_id)

&#x20;       .one()

&#x20;   )

&#x20;   return clinician





\# app/services/generator\_837p.py

from \_\_future\_\_ import annotations



from dataclasses import dataclass

from datetime import datetime, timezone

from decimal import Decimal



from app.models.claim import Claim

from app.models.clinician import Clinician

from app.models.organization import Organization

from app.models.payer import Payer

from app.settings import get\_settings

from app.x12.builder import build\_segment, count\_segments

from app.x12.envelope import build\_iea\_segment, build\_isa\_segment

from app.x12.types import X12Delimiters





@dataclass

class Generated837P:

&#x20;   x12\_text: str

&#x20;   segment\_count: int





def \_split\_name(full\_name: str) -> tuple\[str, str]:

&#x20;   parts = \[p for p in full\_name.strip().split() if p]

&#x20;   if len(parts) < 2:

&#x20;       return full\_name.strip(), ""

&#x20;   return parts\[-1], " ".join(parts\[:-1])





def \_fmt\_amount(value: Decimal) -> str:

&#x20;   return f"{value:.2f}"





def \_patient\_hl\_child\_code(claim: Claim) -> str:

&#x20;   return "0" if claim.patient\_is\_subscriber == "Y" else "1"





def generate\_837p(

&#x20;   organization: Organization,

&#x20;   payer: Payer,

&#x20;   rendering\_clinician: Clinician,

&#x20;   claims: list\[Claim],

&#x20;   isa\_control\_number: str,

&#x20;   gs\_control\_number: str,

&#x20;   st\_control\_number: str,

&#x20;   environment: str,

) -> Generated837P:

&#x20;   settings = get\_settings()

&#x20;   delimiters = X12Delimiters(

&#x20;       element\_separator=settings.x12\_element\_separator,

&#x20;       component\_separator=settings.x12\_component\_separator,

&#x20;       segment\_terminator=settings.x12\_segment\_terminator,

&#x20;       repetition\_separator=settings.x12\_repetition\_separator,

&#x20;   )



&#x20;   now = datetime.now(timezone.utc)

&#x20;   usage\_indicator = "T" if environment == "QA" else "P"

&#x20;   x12: list\[str] = \[]



&#x20;   x12.append(build\_isa\_segment(organization.availity\_submitter\_id, isa\_control\_number, usage\_indicator, now, delimiters))

&#x20;   x12.append(

&#x20;       build\_segment(

&#x20;           "GS",

&#x20;           \[

&#x20;               "HC",

&#x20;               organization.availity\_submitter\_id,

&#x20;               settings.x12\_receiver\_id,

&#x20;               now.strftime("%Y%m%d"),

&#x20;               now.strftime("%H%M"),

&#x20;               gs\_control\_number,

&#x20;               "X",

&#x20;               "005010X222A1",

&#x20;           ],

&#x20;           delimiters,

&#x20;       )

&#x20;   )

&#x20;   x12.append(build\_segment("ST", \["837", st\_control\_number, "005010X222A1"], delimiters))

&#x20;   x12.append(build\_segment("BHT", \["0019", "00", isa\_control\_number, now.strftime("%Y%m%d"), now.strftime("%H%M"), "CH"], delimiters))



&#x20;   x12.append(build\_segment("NM1", \["41", "2", organization.legal\_name, "", "", "", "", "46", organization.availity\_submitter\_id], delimiters))

&#x20;   x12.append(build\_segment("PER", \["IC", "EDI SUPPORT", "TE", organization.phone], delimiters))

&#x20;   x12.append(build\_segment("NM1", \["40", "2", "AVAILITY", "", "", "", "", "46", settings.x12\_receiver\_id], delimiters))



&#x20;   billing\_hl\_number = 1

&#x20;   x12.append(build\_segment("HL", \[billing\_hl\_number, "", "20", "1"], delimiters))

&#x20;   x12.append(build\_segment("NM1", \["85", "2", organization.legal\_name, "", "", "", "", "XX", organization.billing\_npi], delimiters))

&#x20;   x12.append(build\_segment("N3", \[organization.address\_line1], delimiters))

&#x20;   x12.append(build\_segment("N4", \[organization.city, organization.state, organization.postal\_code], delimiters))

&#x20;   x12.append(build\_segment("REF", \["EI", organization.tin\_normalized], delimiters))



&#x20;   hl\_counter = 1

&#x20;   rendering\_last\_name, rendering\_first\_name = \_split\_name(rendering\_clinician.full\_name)



&#x20;   for claim in claims:

&#x20;       hl\_counter += 1

&#x20;       subscriber\_hl = hl\_counter



&#x20;       x12.append(build\_segment("HL", \[subscriber\_hl, billing\_hl\_number, "22", \_patient\_hl\_child\_code(claim)], delimiters))

&#x20;       x12.append(build\_segment("SBR", \["P", "", "", "", "", "", "", "", "CI"], delimiters))

&#x20;       x12.append(

&#x20;           build\_segment(

&#x20;               "NM1",

&#x20;               \["IL", "1", claim.subscriber\_last\_name, claim.subscriber\_first\_name, "", "", "", "MI", claim.subscriber\_member\_id],

&#x20;               delimiters,

&#x20;           )

&#x20;       )

&#x20;       x12.append(build\_segment("N3", \[claim.subscriber\_address\_line1], delimiters))

&#x20;       x12.append(build\_segment("N4", \[claim.subscriber\_city, claim.subscriber\_state, claim.subscriber\_postal\_code], delimiters))

&#x20;       x12.append(build\_segment("DMG", \["D8", claim.subscriber\_dob.strftime("%Y%m%d"), claim.subscriber\_gender], delimiters))

&#x20;       x12.append(build\_segment("NM1", \["PR", "2", payer.payer\_name, "", "", "", "", "PI", payer.payer\_id], delimiters))



&#x20;       if claim.patient\_is\_subscriber != "Y":

&#x20;           hl\_counter += 1

&#x20;           patient\_hl = hl\_counter

&#x20;           patient\_last = claim.patient\_last\_name or claim.subscriber\_last\_name

&#x20;           patient\_first = claim.patient\_first\_name or claim.subscriber\_first\_name

&#x20;           patient\_dob = claim.patient\_dob or claim.subscriber\_dob

&#x20;           patient\_gender = claim.patient\_gender or claim.subscriber\_gender



&#x20;           x12.append(build\_segment("HL", \[patient\_hl, subscriber\_hl, "23", "0"], delimiters))

&#x20;           x12.append(build\_segment("PAT", \["19"], delimiters))

&#x20;           x12.append(build\_segment("NM1", \["QC", "1", patient\_last, patient\_first, "", "", "", "", ""], delimiters))

&#x20;           x12.append(build\_segment("DMG", \["D8", patient\_dob.strftime("%Y%m%d"), patient\_gender], delimiters))



&#x20;       x12.append(

&#x20;           build\_segment(

&#x20;               "CLM",

&#x20;               \[

&#x20;                   claim.patient\_control\_number,

&#x20;                   \_fmt\_amount(claim.total\_charge\_amount),

&#x20;                   "",

&#x20;                   "",

&#x20;                   f"{claim.place\_of\_service\_code}:B:1",

&#x20;                   "Y",

&#x20;                   "A",

&#x20;                   "Y",

&#x20;                   "Y",

&#x20;               ],

&#x20;               delimiters,

&#x20;           )

&#x20;       )



&#x20;       diagnosis\_codes = \[claim.diagnosis\_code\_1, claim.diagnosis\_code\_2, claim.diagnosis\_code\_3, claim.diagnosis\_code\_4]

&#x20;       diagnosis\_codes = \[code for code in diagnosis\_codes if code]

&#x20;       hi\_elements = \[f"ABK:{code}" for code in diagnosis\_codes]

&#x20;       x12.append(build\_segment("HI", hi\_elements, delimiters))



&#x20;       x12.append(

&#x20;           build\_segment(

&#x20;               "NM1",

&#x20;               \["82", "1", rendering\_last\_name, rendering\_first\_name, "", "", "", "XX", rendering\_clinician.rendering\_npi],

&#x20;               delimiters,

&#x20;           )

&#x20;       )



&#x20;       for line in sorted(claim.service\_lines, key=lambda item: item.line\_number):

&#x20;           procedure\_parts = \["HC", line.cpt\_code]

&#x20;           modifiers = \[line.modifier\_1, line.modifier\_2, line.modifier\_3, line.modifier\_4]

&#x20;           for modifier in modifiers:

&#x20;               if modifier:

&#x20;                   procedure\_parts.append(modifier)

&#x20;           composite\_procedure = delimiters.component\_separator.join(procedure\_parts)



&#x20;           x12.append(build\_segment("LX", \[line.line\_number], delimiters))

&#x20;           x12.append(

&#x20;               build\_segment(

&#x20;                   "SV1",

&#x20;                   \[

&#x20;                       composite\_procedure,

&#x20;                       \_fmt\_amount(line.charge\_amount),

&#x20;                       "UN",

&#x20;                       str(line.units),

&#x20;                       "",

&#x20;                       "",

&#x20;                       "",

&#x20;                       line.diagnosis\_pointer,

&#x20;                   ],

&#x20;                   delimiters,

&#x20;               )

&#x20;           )

&#x20;           x12.append(build\_segment("DTP", \["472", "D8", line.service\_date.strftime("%Y%m%d")], delimiters))



&#x20;   body\_without\_se = "".join(x12)

&#x20;   segment\_count = count\_segments(body\_without\_se) + 1

&#x20;   x12.append(build\_segment("SE", \[segment\_count, st\_control\_number], delimiters))

&#x20;   x12.append(build\_segment("GE", \[1, gs\_control\_number], delimiters))

&#x20;   x12.append(build\_iea\_segment(isa\_control\_number, delimiters))



&#x20;   final\_text = "".join(x12)

&#x20;   return Generated837P(x12\_text=final\_text, segment\_count=count\_segments(final\_text))





\# app/services/batch\_837p.py

from \_\_future\_\_ import annotations



import hashlib

import uuid

from datetime import datetime, timezone



from sqlalchemy.orm import Session, joinedload



from app.models.claim import Claim

from app.models.edi\_batch import EdiBatch, EdiBatchItem

from app.models.organization import Organization

from app.models.payer import Payer

from app.schemas.edi\_837p import CreateBatchResponse

from app.services.claim\_validation import validate\_claim\_for\_837p

from app.services.generator\_837p import generate\_837p

from app.services.provider\_rules import resolve\_rendering\_clinician

from app.x12.control\_numbers import next\_numeric\_control\_number





def \_org\_short\_name(legal\_name: str) -> str:

&#x20;   if legal\_name == "Conscious Counseling PLLC":

&#x20;       return "CC"

&#x20;   if legal\_name == "Kindly Kiera LLC":

&#x20;       return "KK"

&#x20;   return "".join(part\[0] for part in legal\_name.split() if part).upper()\[:8]





def create\_837p\_batch(

&#x20;   db: Session,

&#x20;   organization\_id: uuid.UUID,

&#x20;   payer\_id: uuid.UUID,

&#x20;   environment: str,

&#x20;   claim\_ids: list\[uuid.UUID],

) -> CreateBatchResponse | None:

&#x20;   organization = db.query(Organization).filter(Organization.id == organization\_id).one\_or\_none()

&#x20;   payer = db.query(Payer).filter(Payer.id == payer\_id).one\_or\_none()



&#x20;   if organization is None or payer is None:

&#x20;       return None



&#x20;   claims = (

&#x20;       db.query(Claim)

&#x20;       .options(joinedload(Claim.service\_lines))

&#x20;       .filter(

&#x20;           Claim.id.in\_(claim\_ids),

&#x20;           Claim.organization\_id == organization\_id,

&#x20;           Claim.payer\_id == payer\_id,

&#x20;           Claim.status == "READY\_FOR\_BATCH",

&#x20;       )

&#x20;       .all()

&#x20;   )



&#x20;   if not claims:

&#x20;       return None



&#x20;   validation\_errors: list\[str] = \[]

&#x20;   for claim in claims:

&#x20;       validation\_errors.extend(validate\_claim\_for\_837p(claim))



&#x20;   if validation\_errors:

&#x20;       raise ValueError("; ".join(validation\_errors))



&#x20;   rendering\_clinician = resolve\_rendering\_clinician(db, organization)



&#x20;   for claim in claims:

&#x20;       claim.edi\_rendering\_clinician\_id = rendering\_clinician.id



&#x20;   isa\_control\_number = next\_numeric\_control\_number(db, environment)

&#x20;   gs\_control\_number = isa\_control\_number

&#x20;   st\_control\_number = isa\_control\_number



&#x20;   generated = generate\_837p(

&#x20;       organization=organization,

&#x20;       payer=payer,

&#x20;       rendering\_clinician=rendering\_clinician,

&#x20;       claims=claims,

&#x20;       isa\_control\_number=isa\_control\_number,

&#x20;       gs\_control\_number=gs\_control\_number,

&#x20;       st\_control\_number=st\_control\_number,

&#x20;       environment=environment,

&#x20;   )



&#x20;   file\_hash = hashlib.sha256(generated.x12\_text.encode("utf-8")).hexdigest()

&#x20;   file\_name = (

&#x20;       f"{\_org\_short\_name(organization.legal\_name)}\_837P\_{payer.payer\_id}\_{environment}\_"

&#x20;       f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}\_{isa\_control\_number}.x12"

&#x20;   )



&#x20;   batch = EdiBatch(

&#x20;       organization\_id=organization.id,

&#x20;       transaction\_type="837P",

&#x20;       environment=environment,

&#x20;       isa\_control\_number=isa\_control\_number,

&#x20;       gs\_control\_number=gs\_control\_number,

&#x20;       file\_name=file\_name,

&#x20;       file\_hash=file\_hash,

&#x20;       raw\_x12=generated.x12\_text,

&#x20;       status="CREATED",

&#x20;   )

&#x20;   db.add(batch)

&#x20;   db.flush()



&#x20;   for claim in claims:

&#x20;       db.add(

&#x20;           EdiBatchItem(

&#x20;               batch\_id=batch.id,

&#x20;               source\_table="claims",

&#x20;               source\_id=claim.id,

&#x20;               st\_control\_number=st\_control\_number,

&#x20;               status="IN\_BATCH",

&#x20;           )

&#x20;       )

&#x20;       claim.status = "BATCH\_CREATED"



&#x20;   db.commit()



&#x20;   return CreateBatchResponse(

&#x20;       batch\_id=batch.id,

&#x20;       file\_name=batch.file\_name,

&#x20;       claim\_count=len(claims),

&#x20;       status=batch.status,

&#x20;       isa\_control\_number=batch.isa\_control\_number,

&#x20;       gs\_control\_number=batch.gs\_control\_number,

&#x20;   )





\# app/worker/celery\_app.py

from celery import Celery



from app.settings import get\_settings



settings = get\_settings()



celery\_app = Celery(

&#x20;   "edi-platform",

&#x20;   broker=settings.redis\_url,

&#x20;   backend=settings.redis\_url,

)



celery\_app.conf.update(

&#x20;   task\_serializer="json",

&#x20;   accept\_content=\["json"],

&#x20;   result\_serializer="json",

&#x20;   timezone="UTC",

&#x20;   enable\_utc=True,

)





\# app/worker/tasks.py

from app.worker.celery\_app import celery\_app





@celery\_app.task(name="health.ping")

def ping() -> str:

&#x20;   return "pong"





\# app/seeds.py

from sqlalchemy.orm import Session



from app.models.clinician import Clinician

from app.models.organization import Organization





def seed\_organizations(db: Session) -> None:

&#x20;   cc = db.query(Organization).filter(Organization.legal\_name == "Conscious Counseling PLLC").one\_or\_none()

&#x20;   if cc is None:

&#x20;       cc = Organization(

&#x20;           legal\_name="Conscious Counseling PLLC",

&#x20;           tin\_normalized="861384084",

&#x20;           billing\_npi="1982355160",

&#x20;           phone="303-437-2087",

&#x20;           address\_line1="1556 N. Williams St. Unit 101",

&#x20;           address\_line2=None,

&#x20;           city="Denver",

&#x20;           state="CO",

&#x20;           postal\_code="80218-1661",

&#x20;           availity\_submitter\_id="1082546",

&#x20;       )

&#x20;       db.add(cc)

&#x20;       db.flush()



&#x20;       lyndsey = Clinician(

&#x20;           organization\_id=cc.id,

&#x20;           full\_name="Lyndsey Klemme",

&#x20;           credential\_text="LPC LAC NCC",

&#x20;           rendering\_npi="1629632542",

&#x20;           email="Lyndsey@consciouscounseling.co",

&#x20;       )

&#x20;       db.add(lyndsey)

&#x20;       db.flush()

&#x20;       cc.default\_rendering\_clinician\_id = lyndsey.id



&#x20;   kk = db.query(Organization).filter(Organization.legal\_name == "Kindly Kiera LLC").one\_or\_none()

&#x20;   if kk is None:

&#x20;       kk = Organization(

&#x20;           legal\_name="Kindly Kiera LLC",

&#x20;           tin\_normalized="851383748",

&#x20;           billing\_npi="1770242786",

&#x20;           phone="720-440-2617",

&#x20;           address\_line1="1139 York St Apt 306",

&#x20;           address\_line2=None,

&#x20;           city="Denver",

&#x20;           state="CO",

&#x20;           postal\_code="80206-3054",

&#x20;           availity\_submitter\_id="1062487",

&#x20;       )

&#x20;       db.add(kk)

&#x20;       db.flush()



&#x20;       kiera = Clinician(

&#x20;           organization\_id=kk.id,

&#x20;           full\_name="Kiera Rommel",

&#x20;           credential\_text="LPC ATR MPS",

&#x20;           rendering\_npi="1922499581",

&#x20;           email="kindlykiera@creativehealingcolorado.com",

&#x20;       )

&#x20;       db.add(kiera)

&#x20;       db.flush()

&#x20;       kk.default\_rendering\_clinician\_id = kiera.id



&#x20;   db.commit()





\# README.md

\# EDI Platform



\## Run

1\. Start services:

&#x20;  docker compose up --build



2\. Open API:

&#x20;  http://localhost:8000/docs



\## Current scope

\- FastAPI bootstrap

\- PostgreSQL models

\- Celery bootstrap

\- 837P batch creation endpoint

\- starter X12 837P generation



\## Next build steps

\- Alembic migrations

\- object storage adapter

\- SFTP connector

\- 999 parser

\- 270/276 generators

\- inbound file registry



\# File: alembic.ini

\[alembic]

script\_location = alembic

prepend\_sys\_path = .

sqlalchemy.url = postgresql+psycopg://edi:edi@localhost:5432/edi



\[post\_write\_hooks]



\[loggers]

keys = root,sqlalchemy,alembic



\[handlers]

keys = console



\[formatters]

keys = generic



\[logger\_root]

level = WARN

handlers = console



\[logger\_sqlalchemy]

level = WARN

handlers =

qualname = sqlalchemy.engine



\[logger\_alembic]

level = INFO

handlers = console

qualname = alembic



\[handler\_console]

class = StreamHandler

args = (sys.stderr,)

level = NOTSET

formatter = generic



\[formatter\_generic]

format = %(levelname)-5.5s \[%(name)s] %(message)s





\# File: alembic/env.py

from \_\_future\_\_ import annotations



from logging.config import fileConfig



from alembic import context

from sqlalchemy import engine\_from\_config, pool



from app.database import Base

from app.models import \*  # noqa: F403

from app.models.edi\_inbound import EdiInboundFile  # noqa: F401

from app.models.edi\_job import EdiJob  # noqa: F401

from app.models.edi\_sftp\_account import EdiSftpAccount  # noqa: F401

from app.settings import get\_settings



config = context.config

settings = get\_settings()

config.set\_main\_option("sqlalchemy.url", settings.database\_url)



if config.config\_file\_name is not None:

&#x20;   fileConfig(config.config\_file\_name)



target\_metadata = Base.metadata





def run\_migrations\_offline() -> None:

&#x20;   context.configure(

&#x20;       url=settings.database\_url,

&#x20;       target\_metadata=target\_metadata,

&#x20;       literal\_binds=True,

&#x20;       dialect\_opts={"paramstyle": "named"},

&#x20;       compare\_type=True,

&#x20;   )



&#x20;   with context.begin\_transaction():

&#x20;       context.run\_migrations()





def run\_migrations\_online() -> None:

&#x20;   connectable = engine\_from\_config(

&#x20;       config.get\_section(config.config\_ini\_section, {}),

&#x20;       prefix="sqlalchemy.",

&#x20;       poolclass=pool.NullPool,

&#x20;   )



&#x20;   with connectable.connect() as connection:

&#x20;       context.configure(connection=connection, target\_metadata=target\_metadata, compare\_type=True)



&#x20;       with context.begin\_transaction():

&#x20;           context.run\_migrations()





if context.is\_offline\_mode():

&#x20;   run\_migrations\_offline()

else:

&#x20;   run\_migrations\_online()





\# File: alembic/script.py.mako

"""${message}



Revision ID: ${up\_revision}

Revises: ${down\_revision | comma,n}

Create Date: ${create\_date}

"""

from alembic import op

import sqlalchemy as sa

${imports if imports else ""}





revision = ${repr(up\_revision)}

down\_revision = ${repr(down\_revision)}

branch\_labels = ${repr(branch\_labels)}

depends\_on = ${repr(depends\_on)}





def upgrade() -> None:

&#x20;   ${upgrades if upgrades else "pass"}





def downgrade() -> None:

&#x20;   ${downgrades if downgrades else "pass"}





\# File: alembic/versions/0001\_initial.py

from \_\_future\_\_ import annotations



from alembic import op

import sqlalchemy as sa

from sqlalchemy.dialects import postgresql



revision = "0001\_initial"

down\_revision = None

branch\_labels = None

depends\_on = None





def upgrade() -> None:

&#x20;   op.create\_table(

&#x20;       "organizations",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("legal\_name", sa.String(length=255), nullable=False),

&#x20;       sa.Column("tin\_normalized", sa.String(length=9), nullable=False),

&#x20;       sa.Column("billing\_npi", sa.String(length=10), nullable=False),

&#x20;       sa.Column("phone", sa.String(length=25), nullable=False),

&#x20;       sa.Column("address\_line1", sa.String(length=255), nullable=False),

&#x20;       sa.Column("address\_line2", sa.String(length=255), nullable=True),

&#x20;       sa.Column("city", sa.String(length=120), nullable=False),

&#x20;       sa.Column("state", sa.String(length=2), nullable=False),

&#x20;       sa.Column("postal\_code", sa.String(length=15), nullable=False),

&#x20;       sa.Column("availity\_submitter\_id", sa.String(length=50), nullable=False),

&#x20;       sa.Column("default\_rendering\_clinician\_id", postgresql.UUID(as\_uuid=True), nullable=True),

&#x20;       sa.Column("is\_active", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "payers",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("payer\_name", sa.String(length=255), nullable=False),

&#x20;       sa.Column("payer\_id", sa.String(length=80), nullable=False),

&#x20;       sa.Column("availity\_enabled", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("supports\_837p", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("is\_active", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "clinicians",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("full\_name", sa.String(length=255), nullable=False),

&#x20;       sa.Column("credential\_text", sa.String(length=255), nullable=True),

&#x20;       sa.Column("rendering\_npi", sa.String(length=10), nullable=False),

&#x20;       sa.Column("email", sa.String(length=255), nullable=True),

&#x20;       sa.Column("is\_active", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;   )



&#x20;   op.create\_foreign\_key(

&#x20;       "fk\_organizations\_default\_rendering\_clinician",

&#x20;       "organizations",

&#x20;       "clinicians",

&#x20;       \["default\_rendering\_clinician\_id"],

&#x20;       \["id"],

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "claims",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("payer\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("payers.id"), nullable=False),

&#x20;       sa.Column("patient\_id", postgresql.UUID(as\_uuid=True), nullable=False),

&#x20;       sa.Column("service\_clinician\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("clinicians.id"), nullable=True),

&#x20;       sa.Column("edi\_rendering\_clinician\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("clinicians.id"), nullable=True),

&#x20;       sa.Column("claim\_control\_number", sa.String(length=80), nullable=False),

&#x20;       sa.Column("patient\_control\_number", sa.String(length=80), nullable=False),

&#x20;       sa.Column("total\_charge\_amount", sa.Numeric(12, 2), nullable=False),

&#x20;       sa.Column("subscriber\_first\_name", sa.String(length=120), nullable=False),

&#x20;       sa.Column("subscriber\_last\_name", sa.String(length=120), nullable=False),

&#x20;       sa.Column("subscriber\_member\_id", sa.String(length=120), nullable=False),

&#x20;       sa.Column("subscriber\_dob", sa.Date(), nullable=False),

&#x20;       sa.Column("subscriber\_gender", sa.String(length=1), nullable=False),

&#x20;       sa.Column("subscriber\_address\_line1", sa.String(length=255), nullable=False),

&#x20;       sa.Column("subscriber\_city", sa.String(length=120), nullable=False),

&#x20;       sa.Column("subscriber\_state", sa.String(length=2), nullable=False),

&#x20;       sa.Column("subscriber\_postal\_code", sa.String(length=15), nullable=False),

&#x20;       sa.Column("patient\_is\_subscriber", sa.String(length=1), nullable=False, server\_default="Y"),

&#x20;       sa.Column("patient\_first\_name", sa.String(length=120), nullable=True),

&#x20;       sa.Column("patient\_last\_name", sa.String(length=120), nullable=True),

&#x20;       sa.Column("patient\_dob", sa.Date(), nullable=True),

&#x20;       sa.Column("patient\_gender", sa.String(length=1), nullable=True),

&#x20;       sa.Column("place\_of\_service\_code", sa.String(length=2), nullable=False),

&#x20;       sa.Column("diagnosis\_code\_1", sa.String(length=12), nullable=False),

&#x20;       sa.Column("diagnosis\_code\_2", sa.String(length=12), nullable=True),

&#x20;       sa.Column("diagnosis\_code\_3", sa.String(length=12), nullable=True),

&#x20;       sa.Column("diagnosis\_code\_4", sa.String(length=12), nullable=True),

&#x20;       sa.Column("status", sa.String(length=50), nullable=False, server\_default="READY\_FOR\_BATCH"),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "claim\_service\_lines",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("claim\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("claims.id"), nullable=False),

&#x20;       sa.Column("line\_number", sa.Integer(), nullable=False),

&#x20;       sa.Column("service\_date", sa.Date(), nullable=False),

&#x20;       sa.Column("cpt\_code", sa.String(length=10), nullable=False),

&#x20;       sa.Column("modifier\_1", sa.String(length=2), nullable=True),

&#x20;       sa.Column("modifier\_2", sa.String(length=2), nullable=True),

&#x20;       sa.Column("modifier\_3", sa.String(length=2), nullable=True),

&#x20;       sa.Column("modifier\_4", sa.String(length=2), nullable=True),

&#x20;       sa.Column("charge\_amount", sa.Numeric(12, 2), nullable=False),

&#x20;       sa.Column("units", sa.Numeric(8, 2), nullable=False, server\_default="1"),

&#x20;       sa.Column("diagnosis\_pointer", sa.String(length=10), nullable=False, server\_default="1"),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "edi\_batches",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("transaction\_type", sa.String(length=20), nullable=False),

&#x20;       sa.Column("environment", sa.String(length=10), nullable=False),

&#x20;       sa.Column("isa\_control\_number", sa.String(length=20), nullable=False),

&#x20;       sa.Column("gs\_control\_number", sa.String(length=20), nullable=False),

&#x20;       sa.Column("file\_name", sa.String(length=255), nullable=False),

&#x20;       sa.Column("file\_hash", sa.String(length=64), nullable=False),

&#x20;       sa.Column("raw\_x12", sa.Text(), nullable=False),

&#x20;       sa.Column("status", sa.String(length=50), nullable=False, server\_default="CREATED"),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;       sa.UniqueConstraint("environment", "isa\_control\_number", name="uq\_edi\_batches\_env\_isa"),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "edi\_batch\_items",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("batch\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("edi\_batches.id"), nullable=False),

&#x20;       sa.Column("source\_table", sa.String(length=50), nullable=False),

&#x20;       sa.Column("source\_id", postgresql.UUID(as\_uuid=True), nullable=False),

&#x20;       sa.Column("st\_control\_number", sa.String(length=20), nullable=False),

&#x20;       sa.Column("status", sa.String(length=50), nullable=False, server\_default="IN\_BATCH"),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "edi\_sftp\_accounts",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("environment", sa.String(length=10), nullable=False),

&#x20;       sa.Column("host", sa.String(length=255), nullable=False),

&#x20;       sa.Column("port", sa.Integer(), nullable=False, server\_default="22"),

&#x20;       sa.Column("username", sa.String(length=255), nullable=False),

&#x20;       sa.Column("encrypted\_password", sa.LargeBinary(), nullable=False),

&#x20;       sa.Column("upload\_folder", sa.String(length=120), nullable=False, server\_default="SendFiles"),

&#x20;       sa.Column("download\_folder", sa.String(length=120), nullable=False, server\_default="ReceiveFiles"),

&#x20;       sa.Column("is\_active", sa.Boolean(), nullable=False, server\_default=sa.text("true")),

&#x20;       sa.Column("last\_successful\_upload\_at", sa.DateTime(timezone=True), nullable=True),

&#x20;       sa.Column("last\_successful\_download\_at", sa.DateTime(timezone=True), nullable=True),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;       sa.UniqueConstraint("organization\_id", "environment", name="uq\_edi\_sftp\_org\_env"),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "edi\_jobs",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("job\_type", sa.String(length=50), nullable=False),

&#x20;       sa.Column("related\_batch\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("edi\_batches.id"), nullable=True),

&#x20;       sa.Column("related\_inbound\_file\_id", postgresql.UUID(as\_uuid=True), nullable=True),

&#x20;       sa.Column("status", sa.String(length=50), nullable=False, server\_default="QUEUED"),

&#x20;       sa.Column("attempt\_count", sa.Integer(), nullable=False, server\_default="0"),

&#x20;       sa.Column("next\_attempt\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;       sa.Column("last\_error", sa.Text(), nullable=True),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;       sa.Column("completed\_at", sa.DateTime(timezone=True), nullable=True),

&#x20;   )



&#x20;   op.create\_table(

&#x20;       "edi\_inbound\_files",

&#x20;       sa.Column("id", postgresql.UUID(as\_uuid=True), primary\_key=True, nullable=False),

&#x20;       sa.Column("organization\_id", postgresql.UUID(as\_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),

&#x20;       sa.Column("file\_name", sa.String(length=255), nullable=False),

&#x20;       sa.Column("file\_extension", sa.String(length=20), nullable=False),

&#x20;       sa.Column("file\_hash", sa.String(length=64), nullable=False),

&#x20;       sa.Column("transaction\_type", sa.String(length=20), nullable=True),

&#x20;       sa.Column("raw\_x12", sa.Text(), nullable=False),

&#x20;       sa.Column("status", sa.String(length=50), nullable=False, server\_default="DOWNLOADED"),

&#x20;       sa.Column("parsed\_at", sa.DateTime(timezone=True), nullable=True),

&#x20;       sa.Column("created\_at", sa.DateTime(timezone=True), nullable=False, server\_default=sa.text("now()")),

&#x20;       sa.UniqueConstraint("file\_hash", name="uq\_edi\_inbound\_files\_file\_hash"),

&#x20;   )





def downgrade() -> None:

&#x20;   op.drop\_table("edi\_inbound\_files")

&#x20;   op.drop\_table("edi\_jobs")

&#x20;   op.drop\_table("edi\_sftp\_accounts")

&#x20;   op.drop\_table("edi\_batch\_items")

&#x20;   op.drop\_table("edi\_batches")

&#x20;   op.drop\_table("claim\_service\_lines")

&#x20;   op.drop\_table("claims")

&#x20;   op.drop\_constraint("fk\_organizations\_default\_rendering\_clinician", "organizations", type\_="foreignkey")

&#x20;   op.drop\_table("clinicians")

&#x20;   op.drop\_table("payers")

&#x20;   op.drop\_table("organizations")





\# File: app/models/edi\_sftp\_account.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column



from app.database import Base





class EdiSftpAccount(Base):

&#x20;   \_\_tablename\_\_ = "edi\_sftp\_accounts"

&#x20;   \_\_table\_args\_\_ = (UniqueConstraint("organization\_id", "environment", name="uq\_edi\_sftp\_org\_env"),)



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("organizations.id"), nullable=False)

&#x20;   environment: Mapped\[str] = mapped\_column(String(10), nullable=False)

&#x20;   host: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   port: Mapped\[int] = mapped\_column(Integer, nullable=False, default=22)

&#x20;   username: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   encrypted\_password: Mapped\[bytes] = mapped\_column(LargeBinary, nullable=False)

&#x20;   upload\_folder: Mapped\[str] = mapped\_column(String(120), nullable=False, default="SendFiles")

&#x20;   download\_folder: Mapped\[str] = mapped\_column(String(120), nullable=False, default="ReceiveFiles")

&#x20;   is\_active: Mapped\[bool] = mapped\_column(Boolean, nullable=False, default=True)

&#x20;   last\_successful\_upload\_at: Mapped\[datetime | None] = mapped\_column(DateTime(timezone=True), nullable=True)

&#x20;   last\_successful\_download\_at: Mapped\[datetime | None] = mapped\_column(DateTime(timezone=True), nullable=True)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )





\# File: app/models/edi\_job.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import DateTime, ForeignKey, Integer, String, Text

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column



from app.database import Base





class EdiJob(Base):

&#x20;   \_\_tablename\_\_ = "edi\_jobs"



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("organizations.id"), nullable=False)

&#x20;   job\_type: Mapped\[str] = mapped\_column(String(50), nullable=False)

&#x20;   related\_batch\_id: Mapped\[uuid.UUID | None] = mapped\_column(UUID(as\_uuid=True), ForeignKey("edi\_batches.id"), nullable=True)

&#x20;   related\_inbound\_file\_id: Mapped\[uuid.UUID | None] = mapped\_column(UUID(as\_uuid=True), nullable=True)

&#x20;   status: Mapped\[str] = mapped\_column(String(50), nullable=False, default="QUEUED")

&#x20;   attempt\_count: Mapped\[int] = mapped\_column(Integer, nullable=False, default=0)

&#x20;   next\_attempt\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )

&#x20;   last\_error: Mapped\[str | None] = mapped\_column(Text, nullable=True)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )

&#x20;   completed\_at: Mapped\[datetime | None] = mapped\_column(DateTime(timezone=True), nullable=True)





\# File: app/models/edi\_inbound.py

import uuid

from datetime import datetime, timezone



from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import Mapped, mapped\_column



from app.database import Base





class EdiInboundFile(Base):

&#x20;   \_\_tablename\_\_ = "edi\_inbound\_files"

&#x20;   \_\_table\_args\_\_ = (UniqueConstraint("file\_hash", name="uq\_edi\_inbound\_files\_file\_hash"),)



&#x20;   id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), primary\_key=True, default=uuid.uuid4)

&#x20;   organization\_id: Mapped\[uuid.UUID] = mapped\_column(UUID(as\_uuid=True), ForeignKey("organizations.id"), nullable=False)

&#x20;   file\_name: Mapped\[str] = mapped\_column(String(255), nullable=False)

&#x20;   file\_extension: Mapped\[str] = mapped\_column(String(20), nullable=False)

&#x20;   file\_hash: Mapped\[str] = mapped\_column(String(64), nullable=False)

&#x20;   transaction\_type: Mapped\[str | None] = mapped\_column(String(20), nullable=True)

&#x20;   raw\_x12: Mapped\[str] = mapped\_column(Text, nullable=False)

&#x20;   status: Mapped\[str] = mapped\_column(String(50), nullable=False, default="DOWNLOADED")

&#x20;   parsed\_at: Mapped\[datetime | None] = mapped\_column(DateTime(timezone=True), nullable=True)

&#x20;   created\_at: Mapped\[datetime] = mapped\_column(

&#x20;       DateTime(timezone=True),

&#x20;       nullable=False,

&#x20;       default=lambda: datetime.now(timezone.utc),

&#x20;   )





\# File: app/models/\_\_init\_\_.py

from app.models.claim import Claim, ClaimServiceLine

from app.models.clinician import Clinician

from app.models.edi\_batch import EdiBatch, EdiBatchItem

from app.models.edi\_inbound import EdiInboundFile

from app.models.edi\_job import EdiJob

from app.models.edi\_sftp\_account import EdiSftpAccount

from app.models.organization import Organization

from app.models.payer import Payer



\_\_all\_\_ = \[

&#x20;   "Claim",

&#x20;   "ClaimServiceLine",

&#x20;   "Clinician",

&#x20;   "EdiBatch",

&#x20;   "EdiBatchItem",

&#x20;   "EdiInboundFile",

&#x20;   "EdiJob",

&#x20;   "EdiSftpAccount",

&#x20;   "Organization",

&#x20;   "Payer",

]





\# File: app/settings.py

from functools import lru\_cache

from pydantic import Field

from pydantic\_settings import BaseSettings, SettingsConfigDict





class Settings(BaseSettings):

&#x20;   model\_config = SettingsConfigDict(case\_sensitive=False, extra="ignore")



&#x20;   app\_env: str = Field(default="local", alias="APP\_ENV")

&#x20;   api\_host: str = Field(default="0.0.0.0", alias="API\_HOST")

&#x20;   api\_port: int = Field(default=8000, alias="API\_PORT")



&#x20;   database\_url: str = Field(

&#x20;       default="postgresql+psycopg://edi:edi@localhost:5432/edi",

&#x20;       alias="DATABASE\_URL",

&#x20;   )

&#x20;   redis\_url: str = Field(default="redis://localhost:6379/0", alias="REDIS\_URL")



&#x20;   x12\_receiver\_id: str = Field(default="030240928", alias="X12\_RECEIVER\_ID")

&#x20;   x12\_interchange\_sender\_qualifier: str = Field(default="ZZ", alias="X12\_INTERCHANGE\_SENDER\_QUALIFIER")

&#x20;   x12\_interchange\_sender\_id: str = Field(default="AV09311993", alias="X12\_INTERCHANGE\_SENDER\_ID")

&#x20;   x12\_interchange\_receiver\_qualifier: str = Field(default="01", alias="X12\_INTERCHANGE\_RECEIVER\_QUALIFIER")

&#x20;   x12\_interchange\_receiver\_id: str = Field(default="030240928", alias="X12\_INTERCHANGE\_RECEIVER\_ID")



&#x20;   sftp\_connect\_timeout\_seconds: int = 60

&#x20;   sftp\_transfer\_timeout\_seconds: int = 600



&#x20;   x12\_element\_separator: str = "\*"

&#x20;   x12\_component\_separator: str = ":"

&#x20;   x12\_segment\_terminator: str = "\~"

&#x20;   x12\_repetition\_separator: str = "^"





@lru\_cache

def get\_settings() -> Settings:

&#x20;   return Settings()





\# File: app/cli.py

from \_\_future\_\_ import annotations



import argparse



from app.database import SessionLocal

from app.seeds import seed\_organizations





def main() -> None:

&#x20;   parser = argparse.ArgumentParser(description="EDI platform CLI")

&#x20;   subparsers = parser.add\_subparsers(dest="command", required=True)



&#x20;   subparsers.add\_parser("seed", help="Seed base organizations and clinicians")



&#x20;   args = parser.parse\_args()



&#x20;   if args.command == "seed":

&#x20;       with SessionLocal() as db:

&#x20;           seed\_organizations(db)

&#x20;       print("Seed complete")





if \_\_name\_\_ == "\_\_main\_\_":

&#x20;   main()





\# File: app/crypto.py

from base64 import b64decode, b64encode





def encrypt\_string(value: str) -> bytes:

&#x20;   return b64encode(value.encode("utf-8"))





def decrypt\_string(value: bytes) -> str:

&#x20;   return b64decode(value).decode("utf-8")





\# File: app/schemas/sftp.py

import uuid

from typing import Literal



from pydantic import BaseModel





class TestSftpRequest(BaseModel):

&#x20;   organization\_id: uuid.UUID

&#x20;   environment: Literal\["QA", "PROD"]





class UploadPendingRequest(BaseModel):

&#x20;   organization\_id: uuid.UUID

&#x20;   environment: Literal\["QA", "PROD"]





class DownloadNowRequest(BaseModel):

&#x20;   organization\_id: uuid.UUID

&#x20;   environment: Literal\["QA", "PROD"]





class JobResponse(BaseModel):

&#x20;   job\_id: uuid.UUID

&#x20;   status: str





\# File: app/services/job\_service.py

from \_\_future\_\_ import annotations



from datetime import datetime, timedelta, timezone

from uuid import UUID



from sqlalchemy import select

from sqlalchemy.orm import Session



from app.models.edi\_job import EdiJob





RETRY\_DELAYS\_MINUTES = \[0, 5, 15, 30, 60]





def enqueue\_job(

&#x20;   db: Session,

&#x20;   organization\_id: UUID,

&#x20;   job\_type: str,

&#x20;   related\_batch\_id: UUID | None = None,

&#x20;   related\_inbound\_file\_id: UUID | None = None,

) -> EdiJob:

&#x20;   job = EdiJob(

&#x20;       organization\_id=organization\_id,

&#x20;       job\_type=job\_type,

&#x20;       related\_batch\_id=related\_batch\_id,

&#x20;       related\_inbound\_file\_id=related\_inbound\_file\_id,

&#x20;       status="QUEUED",

&#x20;   )

&#x20;   db.add(job)

&#x20;   db.commit()

&#x20;   db.refresh(job)

&#x20;   return job





def claim\_next\_job(db: Session, job\_type: str | None = None) -> EdiJob | None:

&#x20;   now = datetime.now(timezone.utc)

&#x20;   stmt = (

&#x20;       select(EdiJob)

&#x20;       .where(EdiJob.status == "QUEUED", EdiJob.next\_attempt\_at <= now)

&#x20;       .order\_by(EdiJob.created\_at.asc())

&#x20;       .with\_for\_update(skip\_locked=True)

&#x20;   )

&#x20;   if job\_type:

&#x20;       stmt = stmt.where(EdiJob.job\_type == job\_type)



&#x20;   job = db.execute(stmt.limit(1)).scalar\_one\_or\_none()

&#x20;   if job is None:

&#x20;       return None



&#x20;   job.status = "RUNNING"

&#x20;   job.attempt\_count += 1

&#x20;   job.last\_error = None

&#x20;   db.commit()

&#x20;   db.refresh(job)

&#x20;   return job





def complete\_job(db: Session, job: EdiJob) -> EdiJob:

&#x20;   job.status = "COMPLETED"

&#x20;   job.completed\_at = datetime.now(timezone.utc)

&#x20;   db.commit()

&#x20;   db.refresh(job)

&#x20;   return job





def fail\_job(db: Session, job: EdiJob, error: str) -> EdiJob:

&#x20;   attempt\_index = min(job.attempt\_count, len(RETRY\_DELAYS\_MINUTES)) - 1

&#x20;   if attempt\_index < 0:

&#x20;       attempt\_index = 0



&#x20;   if job.attempt\_count >= len(RETRY\_DELAYS\_MINUTES):

&#x20;       job.status = "FAILED"

&#x20;       job.next\_attempt\_at = datetime.now(timezone.utc)

&#x20;   else:

&#x20;       delay = RETRY\_DELAYS\_MINUTES\[attempt\_index]

&#x20;       job.status = "QUEUED"

&#x20;       job.next\_attempt\_at = datetime.now(timezone.utc) + timedelta(minutes=delay)



&#x20;   job.last\_error = error

&#x20;   db.commit()

&#x20;   db.refresh(job)

&#x20;   return job





\# File: app/services/sftp\_service.py

from \_\_future\_\_ import annotations



import os

import posixpath

from dataclasses import dataclass

from datetime import datetime, timezone



import paramiko

from sqlalchemy.orm import Session



from app.crypto import decrypt\_string

from app.models.edi\_batch import EdiBatch

from app.models.edi\_sftp\_account import EdiSftpAccount

from app.settings import get\_settings





@dataclass

class RemoteFile:

&#x20;   name: str

&#x20;   size: int

&#x20;   modified\_at: datetime





class SftpService:

&#x20;   def \_\_init\_\_(self, account: EdiSftpAccount):

&#x20;       self.account = account

&#x20;       self.settings = get\_settings()



&#x20;   def \_connect(self) -> tuple\[paramiko.SSHClient, paramiko.SFTPClient]:

&#x20;       ssh = paramiko.SSHClient()

&#x20;       ssh.set\_missing\_host\_key\_policy(paramiko.AutoAddPolicy())

&#x20;       ssh.connect(

&#x20;           hostname=self.account.host,

&#x20;           port=self.account.port,

&#x20;           username=self.account.username,

&#x20;           password=decrypt\_string(self.account.encrypted\_password),

&#x20;           timeout=self.settings.sftp\_connect\_timeout\_seconds,

&#x20;           banner\_timeout=self.settings.sftp\_connect\_timeout\_seconds,

&#x20;           auth\_timeout=self.settings.sftp\_connect\_timeout\_seconds,

&#x20;       )

&#x20;       sftp = ssh.open\_sftp()

&#x20;       return ssh, sftp



&#x20;   def test\_connection(self) -> None:

&#x20;       ssh, sftp = self.\_connect()

&#x20;       try:

&#x20;           sftp.listdir(self.account.upload\_folder)

&#x20;           sftp.listdir(self.account.download\_folder)

&#x20;       finally:

&#x20;           sftp.close()

&#x20;           ssh.close()



&#x20;   def upload\_batch(self, batch: EdiBatch) -> str:

&#x20;       ssh, sftp = self.\_connect()

&#x20;       try:

&#x20;           remote\_path = posixpath.join(self.account.upload\_folder, batch.file\_name)

&#x20;           with sftp.file(remote\_path, "w") as remote\_file:

&#x20;               remote\_file.write(batch.raw\_x12)

&#x20;           return remote\_path

&#x20;       finally:

&#x20;           sftp.close()

&#x20;           ssh.close()



&#x20;   def list\_receive\_files(self) -> list\[RemoteFile]:

&#x20;       ssh, sftp = self.\_connect()

&#x20;       try:

&#x20;           files: list\[RemoteFile] = \[]

&#x20;           for entry in sftp.listdir\_attr(self.account.download\_folder):

&#x20;               files.append(

&#x20;                   RemoteFile(

&#x20;                       name=entry.filename,

&#x20;                       size=entry.st\_size,

&#x20;                       modified\_at=datetime.fromtimestamp(entry.st\_mtime, tz=timezone.utc),

&#x20;                   )

&#x20;               )

&#x20;           return files

&#x20;       finally:

&#x20;           sftp.close()

&#x20;           ssh.close()



&#x20;   def download\_receive\_file(self, remote\_name: str) -> str:

&#x20;       ssh, sftp = self.\_connect()

&#x20;       try:

&#x20;           remote\_path = posixpath.join(self.account.download\_folder, remote\_name)

&#x20;           with sftp.file(remote\_path, "r") as remote\_file:

&#x20;               content = remote\_file.read()

&#x20;           if isinstance(content, bytes):

&#x20;               return content.decode("utf-8", errors="replace")

&#x20;           return content

&#x20;       finally:

&#x20;           sftp.close()

&#x20;           ssh.close()





def get\_sftp\_account(db: Session, organization\_id, environment: str) -> EdiSftpAccount:

&#x20;   account = (

&#x20;       db.query(EdiSftpAccount)

&#x20;       .filter(

&#x20;           EdiSftpAccount.organization\_id == organization\_id,

&#x20;           EdiSftpAccount.environment == environment,

&#x20;           EdiSftpAccount.is\_active.is\_(True),

&#x20;       )

&#x20;       .one\_or\_none()

&#x20;   )

&#x20;   if account is None:

&#x20;       raise ValueError("Active SFTP account not found")

&#x20;   return account





\# File: app/services/sftp\_job\_runner.py

from \_\_future\_\_ import annotations



import hashlib

import os

from datetime import datetime, timezone

from pathlib import Path

from uuid import UUID



from sqlalchemy.orm import Session



from app.models.edi\_batch import EdiBatch

from app.models.edi\_inbound import EdiInboundFile

from app.models.edi\_sftp\_account import EdiSftpAccount

from app.services.sftp\_service import SftpService, get\_sftp\_account





def upload\_batch\_for\_job(db: Session, batch\_id: UUID) -> str:

&#x20;   batch = db.query(EdiBatch).filter(EdiBatch.id == batch\_id).one()

&#x20;   account = get\_sftp\_account(db, batch.organization\_id, batch.environment)

&#x20;   remote\_path = SftpService(account).upload\_batch(batch)

&#x20;   batch.status = "UPLOADED\_TO\_AVAILITY"

&#x20;   account.last\_successful\_upload\_at = datetime.now(timezone.utc)

&#x20;   db.commit()

&#x20;   return remote\_path





def download\_inbound\_files\_for\_org(db: Session, organization\_id: UUID, environment: str) -> int:

&#x20;   account = get\_sftp\_account(db, organization\_id, environment)

&#x20;   sftp = SftpService(account)

&#x20;   remote\_files = sftp.list\_receive\_files()

&#x20;   downloaded = 0



&#x20;   for remote\_file in remote\_files:

&#x20;       content = sftp.download\_receive\_file(remote\_file.name)

&#x20;       file\_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()



&#x20;       exists = db.query(EdiInboundFile).filter(EdiInboundFile.file\_hash == file\_hash).one\_or\_none()

&#x20;       if exists is not None:

&#x20;           continue



&#x20;       extension = Path(remote\_file.name).suffix.lower().lstrip(".") or "x12"

&#x20;       inbound = EdiInboundFile(

&#x20;           organization\_id=organization\_id,

&#x20;           file\_name=remote\_file.name,

&#x20;           file\_extension=extension,

&#x20;           file\_hash=file\_hash,

&#x20;           raw\_x12=content,

&#x20;           transaction\_type=infer\_transaction\_type(content, extension),

&#x20;           status="DOWNLOADED",

&#x20;       )

&#x20;       db.add(inbound)

&#x20;       downloaded += 1



&#x20;   account.last\_successful\_download\_at = datetime.now(timezone.utc)

&#x20;   db.commit()

&#x20;   return downloaded





def infer\_transaction\_type(content: str, extension: str) -> str | None:

&#x20;   marker\_map = {

&#x20;       "ST\*999": "999",

&#x20;       "ST\*835": "835",

&#x20;       "ST\*271": "271",

&#x20;       "ST\*277": "277",

&#x20;       "ST\*TA1": "TA1",

&#x20;   }

&#x20;   for marker, code in marker\_map.items():

&#x20;       if marker in content:

&#x20;           return code



&#x20;   extension\_map = {

&#x20;       "999": "999",

&#x20;       "835": "835",

&#x20;       "271": "271",

&#x20;       "277": "277",

&#x20;       "ta1": "TA1",

&#x20;       "ack": "ACK",

&#x20;       "x12": None,

&#x20;   }

&#x20;   return extension\_map.get(extension)





\# File: app/api/routes/sftp.py

from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session



from app.database import get\_db

from app.schemas.sftp import DownloadNowRequest, JobResponse, TestSftpRequest, UploadPendingRequest

from app.services.job\_service import enqueue\_job

from app.services.sftp\_service import SftpService, get\_sftp\_account



router = APIRouter()





@router.post("/test", response\_model=dict)

def test\_connection(payload: TestSftpRequest, db: Session = Depends(get\_db)) -> dict\[str, str]:

&#x20;   try:

&#x20;       account = get\_sftp\_account(db, payload.organization\_id, payload.environment)

&#x20;       SftpService(account).test\_connection()

&#x20;       return {"status": "ok"}

&#x20;   except Exception as exc:

&#x20;       raise HTTPException(status\_code=400, detail=str(exc)) from exc





@router.post("/upload-pending", response\_model=JobResponse)

def upload\_pending(payload: UploadPendingRequest, db: Session = Depends(get\_db)) -> JobResponse:

&#x20;   from app.models.edi\_batch import EdiBatch



&#x20;   batch = (

&#x20;       db.query(EdiBatch)

&#x20;       .filter(

&#x20;           EdiBatch.organization\_id == payload.organization\_id,

&#x20;           EdiBatch.environment == payload.environment,

&#x20;           EdiBatch.status == "CREATED",

&#x20;       )

&#x20;       .order\_by(EdiBatch.created\_at.asc())

&#x20;       .first()

&#x20;   )

&#x20;   if batch is None:

&#x20;       raise HTTPException(status\_code=404, detail="No pending batch found")



&#x20;   job = enqueue\_job(

&#x20;       db=db,

&#x20;       organization\_id=payload.organization\_id,

&#x20;       job\_type="UPLOAD",

&#x20;       related\_batch\_id=batch.id,

&#x20;   )

&#x20;   return JobResponse(job\_id=job.id, status=job.status)





@router.post("/download-now", response\_model=JobResponse)

def download\_now(payload: DownloadNowRequest, db: Session = Depends(get\_db)) -> JobResponse:

&#x20;   job = enqueue\_job(

&#x20;       db=db,

&#x20;       organization\_id=payload.organization\_id,

&#x20;       job\_type=f"DOWNLOAD:{payload.environment}",

&#x20;   )

&#x20;   return JobResponse(job\_id=job.id, status=job.status)





\# File: app/main.py

from fastapi import FastAPI



from app.api.routes.edi\_837p import router as edi\_837p\_router

from app.api.routes.health import router as health\_router

from app.api.routes.sftp import router as sftp\_router

from app.database import Base, engine



app = FastAPI(title="EDI Platform", version="0.1.0")



Base.metadata.create\_all(bind=engine)



app.include\_router(health\_router, prefix="/health", tags=\["health"])

app.include\_router(edi\_837p\_router, prefix="/edi/837p", tags=\["edi-837p"])

app.include\_router(sftp\_router, prefix="/edi/sftp", tags=\["sftp"])





\# File: app/worker/celery\_app.py

from celery import Celery



from app.settings import get\_settings



settings = get\_settings()



celery\_app = Celery(

&#x20;   "edi-platform",

&#x20;   broker=settings.redis\_url,

&#x20;   backend=settings.redis\_url,

)



celery\_app.conf.update(

&#x20;   task\_serializer="json",

&#x20;   accept\_content=\["json"],

&#x20;   result\_serializer="json",

&#x20;   timezone="UTC",

&#x20;   enable\_utc=True,

&#x20;   beat\_schedule={

&#x20;       "run-upload-jobs": {

&#x20;           "task": "edi.run\_upload\_jobs",

&#x20;           "schedule": 60.0,

&#x20;       },

&#x20;       "run-download-jobs": {

&#x20;           "task": "edi.run\_download\_jobs",

&#x20;           "schedule": 60.0,

&#x20;       },

&#x20;   },

)





\# File: app/worker/tasks.py

from \_\_future\_\_ import annotations



from sqlalchemy.orm import Session



from app.database import SessionLocal

from app.services.job\_service import claim\_next\_job, complete\_job, fail\_job

from app.services.sftp\_job\_runner import download\_inbound\_files\_for\_org, upload\_batch\_for\_job

from app.worker.celery\_app import celery\_app





@celery\_app.task(name="health.ping")

def ping() -> str:

&#x20;   return "pong"





@celery\_app.task(name="edi.run\_upload\_jobs")

def run\_upload\_jobs() -> int:

&#x20;   processed = 0

&#x20;   with SessionLocal() as db:

&#x20;       while True:

&#x20;           job = claim\_next\_job(db, "UPLOAD")

&#x20;           if job is None:

&#x20;               break



&#x20;           try:

&#x20;               if job.related\_batch\_id is None:

&#x20;                   raise ValueError("Upload job missing related\_batch\_id")

&#x20;               upload\_batch\_for\_job(db, job.related\_batch\_id)

&#x20;               complete\_job(db, job)

&#x20;               processed += 1

&#x20;           except Exception as exc:

&#x20;               fail\_job(db, job, str(exc))

&#x20;   return processed





@celery\_app.task(name="edi.run\_download\_jobs")

def run\_download\_jobs() -> int:

&#x20;   processed = 0

&#x20;   with SessionLocal() as db:

&#x20;       while True:

&#x20;           job = claim\_next\_job(db)

&#x20;           if job is None:

&#x20;               break

&#x20;           if not job.job\_type.startswith("DOWNLOAD:"):

&#x20;               fail\_job(db, job, f"Unsupported job\_type for download worker: {job.job\_type}")

&#x20;               continue



&#x20;           try:

&#x20;               \_, environment = job.job\_type.split(":", 1)

&#x20;               processed += download\_inbound\_files\_for\_org(db, job.organization\_id, environment)

&#x20;               complete\_job(db, job)

&#x20;           except Exception as exc:

&#x20;               fail\_job(db, job, str(exc))

&#x20;   return processed





\# File: app/seeds.py

from sqlalchemy.orm import Session



from app.crypto import encrypt\_string

from app.models.clinician import Clinician

from app.models.edi\_sftp\_account import EdiSftpAccount

from app.models.organization import Organization





def seed\_organizations(db: Session) -> None:

&#x20;   cc = db.query(Organization).filter(Organization.legal\_name == "Conscious Counseling PLLC").one\_or\_none()

&#x20;   if cc is None:

&#x20;       cc = Organization(

&#x20;           legal\_name="Conscious Counseling PLLC",

&#x20;           tin\_normalized="861384084",

&#x20;           billing\_npi="1982355160",

&#x20;           phone="303-437-2087",

&#x20;           address\_line1="1556 N. Williams St. Unit 101",

&#x20;           address\_line2=None,

&#x20;           city="Denver",

&#x20;           state="CO",

&#x20;           postal\_code="80218-1661",

&#x20;           availity\_submitter\_id="1082546",

&#x20;       )

&#x20;       db.add(cc)

&#x20;       db.flush()



&#x20;       lyndsey = Clinician(

&#x20;           organization\_id=cc.id,

&#x20;           full\_name="Lyndsey Klemme",

&#x20;           credential\_text="LPC LAC NCC",

&#x20;           rendering\_npi="1629632542",

&#x20;           email="Lyndsey@consciouscounseling.co",

&#x20;       )

&#x20;       db.add(lyndsey)

&#x20;       db.flush()

&#x20;       cc.default\_rendering\_clinician\_id = lyndsey.id



&#x20;       db.add(

&#x20;           EdiSftpAccount(

&#x20;               organization\_id=cc.id,

&#x20;               environment="QA",

&#x20;               host="qa-files.availity.com",

&#x20;               port=22,

&#x20;               username="replace-me",

&#x20;               encrypted\_password=encrypt\_string("replace-me"),

&#x20;           )

&#x20;       )

&#x20;       db.add(

&#x20;           EdiSftpAccount(

&#x20;               organization\_id=cc.id,

&#x20;               environment="PROD",

&#x20;               host="files.availity.com",

&#x20;               port=22,

&#x20;               username="replace-me",

&#x20;               encrypted\_password=encrypt\_string("replace-me"),

&#x20;           )

&#x20;       )



&#x20;   kk = db.query(Organization).filter(Organization.legal\_name == "Kindly Kiera LLC").one\_or\_none()

&#x20;   if kk is None:

&#x20;       kk = Organization(

&#x20;           legal\_name="Kindly Kiera LLC",

&#x20;           tin\_normalized="851383748",

&#x20;           billing\_npi="1770242786",

&#x20;           phone="720-440-2617",

&#x20;           address\_line1="1139 York St Apt 306",

&#x20;           address\_line2=None,

&#x20;           city="Denver",

&#x20;           state="CO",

&#x20;           postal\_code="80206-3054",

&#x20;           availity\_submitter\_id="1062487",

&#x20;       )

&#x20;       db.add(kk)

&#x20;       db.flush()



&#x20;       kiera = Clinician(

&#x20;           organization\_id=kk.id,

&#x20;           full\_name="Kiera Rommel",

&#x20;           credential\_text="LPC ATR MPS",

&#x20;           rendering\_npi="1922499581",

&#x20;           email="kindlykiera@creativehealingcolorado.com",

&#x20;       )

&#x20;       db.add(kiera)

&#x20;       db.flush()

&#x20;       kk.default\_rendering\_clinician\_id = kiera.id



&#x20;       db.add(

&#x20;           EdiSftpAccount(

&#x20;               organization\_id=kk.id,

&#x20;               environment="QA",

&#x20;               host="qa-files.availity.com",

&#x20;               port=22,

&#x20;               username="replace-me",

&#x20;               encrypted\_password=encrypt\_string("replace-me"),

&#x20;           )

&#x20;       )

&#x20;       db.add(

&#x20;           EdiSftpAccount(

&#x20;               organization\_id=kk.id,

&#x20;               environment="PROD",

&#x20;               host="files.availity.com",

&#x20;               port=22,

&#x20;               username="replace-me",

&#x20;               encrypted\_password=encrypt\_string("replace-me"),

&#x20;           )

&#x20;       )



&#x20;   db.commit()





\# File: README.md

\# EDI Platform



\## Run

```bash

docker compose up --build

Migrate

pip install -e .

alembic upgrade head

Seed

python -m app.cli seed

API

POST /edi/837p/batches

POST /edi/sftp/test

POST /edi/sftp/upload-pending

POST /edi/sftp/download-now

Notes

edi\_sftp\_accounts is seeded with placeholder credentials.

Replace those before testing real SFTP.

Downloaded inbound files are stored in DB as raw X12 for now.

Duplicate inbound detection uses SHA-256 file hash.

Remote ReceiveFiles are not deleted in this MVP slice.



Important fixes I made while extending it:

\- added a real migration path instead of `create\_all`

\- added missing SFTP/job/inbound tables from your spec

\- added retry/backoff logic for worker jobs

\- split SFTP connection logic from job execution

\- kept ReceiveFiles non-destructive, matching your MVP rule :contentReference\[oaicite:1]{index=1}



Two things to tighten next:

1\. \*\*Remove `Base.metadata.create\_all()`\*\* once Alembic is fully in charge in every environment.

2\. \*\*Stop storing raw X12 in DB\*\* and move it to S3/MinIO, keeping only object URIs and hashes.



\*\*a.\*\* Add S3/MinIO raw file storage and replace `raw\_x12` DB storage with object URIs  

\*\*b.\*\* Add the 999 inbound parser and wire it to batch status updates



