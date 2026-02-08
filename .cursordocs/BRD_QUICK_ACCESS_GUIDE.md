# COLLMIND BRD - QUICK ACCESS GUIDE
## For New Chat Sessions

**Date:** January 7, 2026  
**Purpose:** Navigate BRD files in /mnt/user-data/outputs/

---

## 🚀 QUICK START (Copy-Paste This)

**In any new chat, use this command:**
```
Show me the BRD Package Index:
view /mnt/user-data/outputs/CollMind_BRD/00_BRD_PACKAGE_INDEX.md
```

---

## 📂 FILE LOCATIONS

**ORGANIZED STRUCTURE:** All BRD files are in: `/mnt/user-data/outputs/CollMind_BRD/`

### **Master Documents:**
```bash
/mnt/user-data/outputs/CollMind_BRD/00_BRD_PACKAGE_INDEX.md      # START HERE
/mnt/user-data/outputs/CollMind_BRD/README.md                    # Quick Start
/mnt/user-data/outputs/CollMind_BRD/BRD_QUICK_ACCESS_GUIDE.md   # This file
```

### **Main BRD (12 Sections):**
```bash
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_01_Executive_Summary.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_02_Product_Overview.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_03_Core_Components.md        # ⭐ Critical
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_04_Actuals_First_Mode.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_05_Planning_First_Mode.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_06_Data_Integration.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_07_Security_Roles.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_08_Reporting.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_09_NFR.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_10_Roadmap.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_11_Assumptions_Risks.md
/mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_12_Glossary.md
```

### **Addendum (MANDATORY):**
```bash
/mnt/user-data/outputs/CollMind_BRD/02_Addendum/BRD_Addendum_Technical_Clarifications.md  # 🔴 Critical
```

### **Candidate Log (ACTIVE):**
```bash
/mnt/user-data/outputs/CollMind_BRD/03_Candidate_Log/BRD_2.0_Candidate_Log.md
```

### **Reviews (REFERENCE):**
```bash
/mnt/user-data/outputs/CollMind_BRD/04_Reviews/BRD_Consolidated_For_Opus_Review.md
/mnt/user-data/outputs/CollMind_BRD/04_Reviews/Opus_Review_Prompt.md
```

---

## 🎯 COMMON COMMANDS

### **Read Package Index:**
```
view /mnt/user-data/outputs/CollMind_BRD/00_BRD_PACKAGE_INDEX.md
```

### **Read Core Components (Critical for Engineering):**
```
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_03_Core_Components.md
```

### **Read Addendum (MANDATORY before development):**
```
view /mnt/user-data/outputs/CollMind_BRD/02_Addendum/BRD_Addendum_Technical_Clarifications.md
```

### **Read Candidate Log (Phase 1 tracking):**
```
view /mnt/user-data/outputs/CollMind_BRD/03_Candidate_Log/BRD_2.0_Candidate_Log.md
```

### **List all BRD sections:**
```
bash: ls -1 /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/
```

### **List all folders:**
```
bash: ls -la /mnt/user-data/outputs/CollMind_BRD/
```

---

## 📋 ROLE-BASED QUICK ACCESS

### **👨‍💻 For Engineers:**
```bash
# Critical files in order:
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_03_Core_Components.md
view /mnt/user-data/outputs/CollMind_BRD/02_Addendum/BRD_Addendum_Technical_Clarifications.md
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_04_Actuals_First_Mode.md
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_05_Planning_First_Mode.md
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_06_Data_Integration.md
```

### **💼 For Product Owners:**
```bash
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_01_Executive_Summary.md
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_02_Product_Overview.md
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_10_Roadmap.md
view /mnt/user-data/outputs/CollMind_BRD/03_Candidate_Log/BRD_2.0_Candidate_Log.md
```

### **📊 For Data Engineering:**
```bash
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_06_Data_Integration.md
view /mnt/user-data/outputs/CollMind_BRD/02_Addendum/BRD_Addendum_Technical_Clarifications.md  # Read H4!
view /mnt/user-data/outputs/CollMind_BRD/03_Candidate_Log/BRD_2.0_Candidate_Log.md  # Check CANDIDATE-005
```

### **🔒 For Security:**
```bash
view /mnt/user-data/outputs/CollMind_BRD/01_Main_BRD/Section_07_Security_Roles.md
view /mnt/user-data/outputs/CollMind_BRD/02_Addendum/BRD_Addendum_Technical_Clarifications.md  # Read H5!
```

---

## 🔍 SEARCH COMMANDS

### **Search for specific term:**
```bash
bash: grep -r "KPI Engine" /mnt/user-data/outputs/Section_*.md
bash: grep -r "Budget" /mnt/user-data/outputs/Section_*.md
bash: grep -r "Baseline" /mnt/user-data/outputs/BRD_*.md
```

### **Find section containing topic:**
```bash
bash: grep -l "Approval Workflow" /mnt/user-data/outputs/Section_*.md
bash: grep -l "Formula Security" /mnt/user-data/outputs/BRD_*.md
```

### **Count pages/words:**
```bash
bash: wc -l /mnt/user-data/outputs/Section_03_Core_Components.md
bash: wc -w /mnt/user-data/outputs/BRD_Addendum_Technical_Clarifications.md
```

---

## 📦 DOWNLOAD ALL FILES

### **Create ZIP archive:**
```bash
bash: cd /mnt/user-data/outputs && \
      tar -czf BRD_Package.tar.gz \
      00_BRD_PACKAGE_INDEX.md README.md \
      Section_*.md \
      BRD_Addendum_Technical_Clarifications.md \
      BRD_2.0_Candidate_Log.md \
      BRD_Consolidated_For_Opus_Review.md \
      Opus_Review_Prompt.md

# Then download: BRD_Package.tar.gz
```

### **List what's in outputs:**
```bash
bash: ls -lh /mnt/user-data/outputs/ | grep -E "(Section_|BRD_|00_|README)"
```

---

## ⚠️ IMPORTANT NOTES

### **File Naming:**
- ✅ Final versions: `Section_01` through `Section_12` (no version suffix)
- ⚠️ Old versions also exist: `Section_01_v2.md`, `Section_01_v3.md` (IGNORE THESE)
- ✅ Always use files WITHOUT version numbers

### **What's NOT in outputs:**
- ❌ Folder structure (all files are flat)
- ❌ Original project files (those are in /mnt/project/)

### **What IS in outputs:**
- ✅ All 18 final BRD files
- ✅ Package Index + README
- ✅ Complete and production-ready

---

## 🎯 TYPICAL NEW CHAT WORKFLOW

**Step 1: Load Package Index**
```
"Show me the BRD Package Index"
→ Claude shows 00_BRD_PACKAGE_INDEX.md
```

**Step 2: Navigate to Needed Section**
```
"Show me Section 3 Core Components"
→ Claude shows Section_03_Core_Components.md
```

**Step 3: Reference Addendum**
```
"Show me the BRD Addendum, specifically H1 about KPI Engine"
→ Claude shows relevant section
```

**Step 4: Track Progress**
```
"Show me the Candidate Log, what's the status of CANDIDATE-001?"
→ Claude shows candidate tracking
```

---

## 🚀 SAMPLE PROMPTS FOR NEW CHAT

### **General:**
```
"I need to review the CollMind BRD. Show me the package index."
"What sections are in the BRD? List them."
"Show me the README for the BRD package."
```

### **Specific Sections:**
```
"Show me the Core Components section (Section 3)."
"I need to read about Planning-First Mode."
"What does Section 8 say about reporting?"
```

### **Addendum (Critical):**
```
"Show me the BRD Addendum, I need to understand H1 (KPI performance)."
"What are the 5 HIGH PRIORITY items in the Addendum?"
"Read me H4 from the Addendum about baseline data."
```

### **Candidate Log:**
```
"Show me the BRD 2.0 Candidate Log."
"What's the status of CANDIDATE-005 (baseline data)?"
"Which candidates are CRITICAL for Phase 2?"
```

### **Search & Analysis:**
```
"Search all BRD sections for 'approval workflow'."
"How many times is 'budget concurrency' mentioned?"
"Find all references to 'formula security'."
```

---

## 📞 TROUBLESHOOTING

### **Problem: Can't find BRD files**
**Solution:**
```bash
bash: ls /mnt/user-data/outputs/Section_*.md
# This will list all 12 sections
```

### **Problem: Not sure which file to read**
**Solution:**
```
"Show me 00_BRD_PACKAGE_INDEX.md, it has the complete navigation guide"
```

### **Problem: Want to see all files at once**
**Solution:**
```bash
bash: ls -lh /mnt/user-data/outputs/ | grep -E "^-.*\.md$" | awk '{print $9, $5}'
```

### **Problem: Old version vs new version**
**Solution:**
Always use files WITHOUT version suffix:
- ✅ `Section_03_Core_Components.md` (correct)
- ❌ `Section_03_Core_Components_v3.md` (old, ignore)

---

## 🎉 SUCCESS CHECKLIST

**After reading this guide, you should be able to:**
- [x] Access any BRD section in a new chat
- [x] Find the Package Index quickly
- [x] Navigate role-based reading guides
- [x] Read critical files (Addendum, Candidate Log)
- [x] Search for specific topics
- [x] Download complete package if needed

---

**REMEMBER:** All files are in `/mnt/user-data/outputs/`  
**START HERE:** `00_BRD_PACKAGE_INDEX.md`  
**CRITICAL:** `BRD_Addendum_Technical_Clarifications.md` (MANDATORY)

---

**END OF QUICK ACCESS GUIDE**

**Save this file for future reference!**
**Location:** /mnt/user-data/outputs/BRD_QUICK_ACCESS_GUIDE.md

---
