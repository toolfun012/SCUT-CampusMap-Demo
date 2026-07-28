#include <iostream>
#include <fstream>
#include <direct.h>
#include <string>
#include <vector>

// Initial campus map annotations for:
// D:/Study/校内导航小程序项目/微信图片_20260728004126_141_1.png
//
// Coordinate system:
// - origin: top-left corner of the original image
// - x grows to the right, y grows downward
// - image size: 3629 x 4161
//
// The polygon regions below are first-pass visual annotations. They are meant
// to bootstrap the demo data model, not to be final surveying data.

namespace campus
{
constexpr int kMapImageWidth = 3629;
constexpr int kMapImageHeight = 4161;

struct PixelPoint
{
    int x;
    int y;
};

enum class PlaceType
{
    Building,
    Dormitory,
    Gate,
    Dining,
    Sports,
    Landscape,
    Square,
    Road,
    Bridge,
    Service
};

struct PlaceArea
{
    std::string id;
    std::string name;
    PlaceType type;
    PixelPoint center;
    std::vector<std::vector<PixelPoint> > regions;

    PlaceArea(const std::string& idValue,
              const std::string& nameValue,
              PlaceType typeValue,
              PixelPoint centerValue,
              const std::vector<PixelPoint>& singleRegion)
        : id(idValue),
          name(nameValue),
          type(typeValue),
          center(centerValue),
          regions(1, singleRegion)
    {
    }

    PlaceArea(const std::string& idValue,
              const std::string& nameValue,
              PlaceType typeValue,
              PixelPoint centerValue,
              const std::vector<std::vector<PixelPoint> >& regionList)
        : id(idValue),
          name(nameValue),
          type(typeValue),
          center(centerValue),
          regions(regionList)
    {
    }
};

struct RoadPolyline
{
    std::string id;
    std::string name;
    std::vector<PixelPoint> points;
    int width;
};

const char* ToString(PlaceType type)
{
    switch (type)
    {
    case PlaceType::Building: return "building";
    case PlaceType::Dormitory: return "dormitory";
    case PlaceType::Gate: return "gate";
    case PlaceType::Dining: return "dining";
    case PlaceType::Sports: return "sports";
    case PlaceType::Landscape: return "landscape";
    case PlaceType::Square: return "square";
    case PlaceType::Road: return "road";
    case PlaceType::Bridge: return "bridge";
    case PlaceType::Service: return "service";
    }
    return "unknown";
}

const char* FillColor(PlaceType type)
{
    switch (type)
    {
    case PlaceType::Building: return "#2563eb";
    case PlaceType::Dormitory: return "#db2777";
    case PlaceType::Gate: return "#f97316";
    case PlaceType::Dining: return "#ea580c";
    case PlaceType::Sports: return "#16a34a";
    case PlaceType::Landscape: return "#0891b2";
    case PlaceType::Square: return "#7c3aed";
    case PlaceType::Road: return "#475569";
    case PlaceType::Bridge: return "#0f766e";
    case PlaceType::Service: return "#ca8a04";
    }
    return "#111827";
}

std::vector<PlaceArea> BuildInitialPlaceAreas()
{
    return {
        // Gates.
        {"north_gate", "北门 / NORTH GATE", PlaceType::Gate, {2205, 70}, {{2135, 35}, {2275, 35}, {2280, 125}, {2135, 125}}},
        {"north_1_gate", "北一门 / NORTH 1 GATE", PlaceType::Gate, {990, 280}, {{860, 220}, {1070, 215}, {1090, 330}, {885, 340}}},
        {"west_4_gate", "西四门 / WEST 4 GATE", PlaceType::Gate, {285, 905}, {{205, 875}, {355, 872}, {360, 935}, {210, 940}}},
        {"west_3_gate", "西三门 / WEST 3 GATE", PlaceType::Gate, {330, 1290}, {{255, 1255}, {405, 1250}, {410, 1325}, {270, 1340}}},
        {"west_2_gate", "西二门 / WEST 2 GATE", PlaceType::Gate, {325, 1840}, {{245, 1790}, {405, 1790}, {415, 1870}, {275, 1885}}},
        {"west_1_gate", "西一门 / WEST 1 GATE", PlaceType::Gate, {710, 2405}, {{635, 2365}, {790, 2368}, {820, 2445}, {690, 2475}}},
        {"west_gate", "西门 / WEST GATE", PlaceType::Gate, {1525, 3120}, {{1420, 3010}, {1595, 3035}, {1620, 3195}, {1475, 3200}}},
        {"east_1_gate", "东一门 / EAST 1 GATE", PlaceType::Gate, {1035, 1905}, {{910, 1825}, {1115, 1845}, {1120, 1975}, {940, 1970}}},
        {"east_2_gate", "东二门 / EAST 2 GATE", PlaceType::Gate, {1080, 905}, {{975, 820}, {1170, 830}, {1180, 985}, {1000, 985}}},
        {"east_gate", "东门 / EAST GATE", PlaceType::Gate, {3140, 2030}, {{3060, 1940}, {3230, 1950}, {3235, 2080}, {3075, 2080}}},
        {"south_gate", "南门 / SOUTH GATE", PlaceType::Gate, {3075, 2985}, {{3000, 2880}, {3180, 2885}, {3185, 3035}, {3030, 3035}}},

        // C area dormitories/buildings.
        {"c1", "C1", PlaceType::Dormitory, {835, 2190}, std::vector<std::vector<PixelPoint> >{{{690, 2135}, {910, 2135}, {910, 2225}, {690, 2225}}, {{620, 2220}, {735, 2220}, {735, 2285}, {620, 2285}}}},
        {"c2", "C2", PlaceType::Dormitory, {585, 2055}, std::vector<std::vector<PixelPoint> >{{{500, 2000}, {640, 2000}, {640, 2150}, {500, 2150}}, {{420, 1990}, {520, 1990}, {520, 2050}, {420, 2050}}}},
        {"c3", "C3", PlaceType::Dormitory, {825, 1990}, std::vector<std::vector<PixelPoint> >{{{710, 1905}, {905, 1905}, {905, 2035}, {710, 2035}}, {{620, 1995}, {720, 1995}, {720, 2070}, {620, 2070}}}},
        {"c4", "C4", PlaceType::Dormitory, {470, 1810}, std::vector<std::vector<PixelPoint> >{{{345, 1765}, {570, 1765}, {570, 1855}, {345, 1855}}, {{300, 1810}, {390, 1810}, {390, 1900}, {300, 1900}}}},
        {"c5", "C5", PlaceType::Dormitory, {735, 1810}, std::vector<std::vector<PixelPoint> >{{{630, 1765}, {850, 1765}, {850, 1855}, {630, 1855}}, {{585, 1815}, {680, 1815}, {680, 1885}, {585, 1885}}}},
        {"c6", "C6", PlaceType::Dormitory, {730, 1605}, std::vector<std::vector<PixelPoint> >{{{620, 1535}, {835, 1535}, {835, 1600}, {620, 1600}}, {{620, 1585}, {685, 1585}, {685, 1695}, {620, 1695}}, {{675, 1640}, {875, 1640}, {875, 1705}, {675, 1705}}, {{815, 1585}, {875, 1585}, {875, 1660}, {815, 1660}}}},
        {"c7", "C7", PlaceType::Dormitory, {390, 1600}, std::vector<std::vector<PixelPoint> >{{{265, 1525}, {505, 1525}, {505, 1590}, {265, 1590}}, {{265, 1580}, {330, 1580}, {330, 1685}, {265, 1685}}, {{320, 1640}, {600, 1640}, {600, 1690}, {320, 1690}}, {{500, 1585}, {600, 1585}, {600, 1650}, {500, 1650}}}},
        {"c8", "C8", PlaceType::Dormitory, {620, 1405}, std::vector<std::vector<PixelPoint> >{{{460, 1368}, {795, 1368}, {795, 1455}, {460, 1455}}, {{370, 1390}, {470, 1390}, {470, 1495}, {370, 1495}}}},
        {"c9", "C9", PlaceType::Dormitory, {660, 1215}, std::vector<std::vector<PixelPoint> >{{{405, 1175}, {860, 1175}, {860, 1260}, {405, 1260}}, {{350, 1195}, {460, 1195}, {460, 1265}, {350, 1265}}}},
        {"c10", "C10", PlaceType::Dormitory, {725, 1010}, std::vector<std::vector<PixelPoint> >{{{610, 925}, {875, 925}, {875, 980}, {610, 980}}, {{610, 955}, {680, 955}, {680, 1105}, {610, 1105}}, {{680, 1070}, {870, 1070}, {870, 1135}, {680, 1135}}, {{820, 955}, {875, 955}, {875, 1080}, {820, 1080}}}},
        {"c11", "C11", PlaceType::Dormitory, {455, 1020}, std::vector<std::vector<PixelPoint> >{{{385, 920}, {585, 920}, {585, 985}, {385, 985}}, {{385, 955}, {455, 955}, {455, 1115}, {385, 1115}}, {{405, 1070}, {575, 1070}, {575, 1130}, {405, 1130}}, {{530, 1000}, {585, 1000}, {585, 1075}, {530, 1075}}}},
        {"c12", "C12", PlaceType::Dormitory, {355, 735}, std::vector<std::vector<PixelPoint> >{{{245, 640}, {430, 640}, {430, 710}, {245, 710}}, {{245, 665}, {320, 665}, {320, 835}, {245, 835}}, {{355, 725}, {480, 725}, {480, 810}, {355, 810}}}},
        {"c13", "C13", PlaceType::Dormitory, {585, 595}, std::vector<std::vector<PixelPoint> >{{{490, 510}, {690, 510}, {690, 585}, {490, 585}}, {{500, 565}, {570, 565}, {570, 705}, {500, 705}}, {{650, 590}, {750, 590}, {750, 670}, {650, 670}}}},
        {"c14", "C14", PlaceType::Dormitory, {830, 485}, std::vector<std::vector<PixelPoint> >{{{745, 390}, {940, 390}, {940, 470}, {745, 470}}, {{760, 460}, {835, 460}, {835, 590}, {760, 590}}, {{920, 470}, {1010, 470}, {1010, 545}, {920, 545}}}},
        {"c15", "C15", PlaceType::Dormitory, {1110, 410}, std::vector<std::vector<PixelPoint> >{{{1010, 330}, {1210, 330}, {1210, 405}, {1010, 405}}, {{1030, 395}, {1110, 395}, {1110, 520}, {1030, 520}}, {{1165, 400}, {1260, 400}, {1260, 485}, {1165, 485}}}},
        {"c16", "C16", PlaceType::Dormitory, {1085, 610}, std::vector<std::vector<PixelPoint> >{{{980, 565}, {1215, 565}, {1215, 675}, {980, 675}}, {{940, 615}, {1035, 615}, {1035, 700}, {940, 700}}}},
        {"c17", "C17", PlaceType::Dormitory, {830, 790}, std::vector<std::vector<PixelPoint> >{{{680, 735}, {1000, 735}, {1000, 805}, {680, 805}}, {{560, 805}, {745, 805}, {745, 875}, {560, 875}}, {{835, 830}, {1065, 830}, {1065, 890}, {835, 890}}}},

        // D area.
        {"d1", "D1", PlaceType::Dormitory, {945, 2350}, {{860, 2260}, {1000, 2225}, {1045, 2365}, {905, 2425}}},
        {"d2", "D2", PlaceType::Dormitory, {1030, 2110}, {{965, 2035}, {1080, 2000}, {1125, 2125}, {1010, 2185}}},
        {"d3", "D3", PlaceType::Dormitory, {1110, 1940}, {{1060, 1875}, {1175, 1830}, {1220, 1955}, {1100, 2020}}},
        {"d4", "D4", PlaceType::Dormitory, {1145, 1795}, {{1090, 1720}, {1210, 1680}, {1260, 1810}, {1140, 1880}}},
        {"d5", "D5", PlaceType::Dormitory, {1015, 1740}, {{900, 1660}, {1070, 1590}, {1130, 1740}, {970, 1810}}},

        // A teaching area and nearby named places.
        {"a1", "A1", PlaceType::Building, {1970, 1850}, {{1865, 1770}, {2070, 1770}, {2070, 1930}, {1860, 1930}}},
        {"a2", "A2", PlaceType::Building, {1960, 1640}, {{1855, 1545}, {2075, 1540}, {2075, 1710}, {1855, 1715}}},
        {"a3", "A3", PlaceType::Building, {1965, 1435}, {{1845, 1345}, {2070, 1345}, {2075, 1505}, {1850, 1510}}},
        {"a4", "A4", PlaceType::Building, {2080, 1168}, {{1960, 1070}, {2200, 1065}, {2205, 1230}, {1960, 1235}}},
        {"a5", "A5", PlaceType::Building, {2285, 1135}, {{2200, 1015}, {2385, 1010}, {2400, 1180}, {2210, 1195}}},
        {"boxue_square", "博学广场 / Boxue Square", PlaceType::Square, {2120, 1710}, {{2020, 1160}, {2240, 1160}, {2230, 2070}, {2025, 2070}}},
        {"boxue_bridge", "博学桥 / Boxue Bridge", PlaceType::Bridge, {2290, 1750}, {{2205, 1470}, {2355, 1470}, {2370, 1990}, {2220, 1990}}},
        {"yan_lake", "韵湖 / Yan Lake", PlaceType::Landscape, {2260, 1510}, {{2210, 1180}, {2380, 1180}, {2410, 1985}, {2220, 1990}}},

        // B area.
        {"b1", "B1", PlaceType::Building, {3115, 2605}, {{3005, 2485}, {3255, 2490}, {3270, 2725}, {3030, 2735}}},
        {"b2", "B2", PlaceType::Building, {2860, 3240}, {{2745, 3100}, {2970, 3055}, {3050, 3340}, {2820, 3380}}},
        {"b3", "B3", PlaceType::Building, {2930, 2465}, {{2820, 2355}, {3055, 2345}, {3070, 2560}, {2840, 2570}}},
        {"b4", "B4", PlaceType::Building, {2545, 3120}, {{2415, 3010}, {2670, 3005}, {2685, 3225}, {2435, 3235}}},
        {"b5", "B5", PlaceType::Building, {2705, 2365}, {{2590, 2260}, {2820, 2255}, {2830, 2460}, {2600, 2475}}},
        {"b6", "B6", PlaceType::Building, {2310, 2980}, {{2185, 2880}, {2440, 2875}, {2455, 3100}, {2200, 3115}}},
        {"b7", "B7", PlaceType::Building, {2520, 2220}, {{2405, 2110}, {2650, 2110}, {2660, 2315}, {2415, 2330}}},
        {"b8", "B8", PlaceType::Building, {2050, 2875}, {{1915, 2760}, {2180, 2755}, {2185, 2985}, {1930, 2995}}},
        {"b9", "B9", PlaceType::Building, {2695, 1885}, {{2570, 1775}, {2835, 1770}, {2845, 1985}, {2580, 1995}}},
        {"b10", "B10", PlaceType::Building, {2690, 1540}, {{2570, 1440}, {2825, 1440}, {2835, 1650}, {2585, 1660}}},
        {"b11", "B11", PlaceType::Building, {2560, 1250}, {{2445, 1130}, {2700, 1125}, {2720, 1330}, {2460, 1350}}},
        {"b12", "B12", PlaceType::Building, {2280, 3650}, {{2120, 3535}, {2440, 3530}, {2450, 3770}, {2140, 3785}}},
        {"b13", "B13", PlaceType::Building, {2150, 3485}, {{1980, 3390}, {2290, 3385}, {2300, 3580}, {2000, 3590}}},
        {"academic_auditorium", "学术大讲堂 / Academic Auditorium", PlaceType::Building, {2395, 2210}, {{2230, 2100}, {2605, 2100}, {2620, 2320}, {2240, 2330}}},
        {"southgate_square", "南门广场 / Southgate Square", PlaceType::Square, {2940, 2710}, {{2770, 2580}, {3190, 2570}, {3200, 2900}, {2800, 2920}}},

        // E area and north-east dormitories.
        {"e1", "E1", PlaceType::Dormitory, {2530, 240}, {{2385, 160}, {2590, 320}, {2470, 450}, {2280, 290}}},
        {"e2", "E2", PlaceType::Dormitory, {2805, 225}, {{2700, 120}, {2900, 120}, {2920, 270}, {2720, 280}}},
        {"e3", "E3", PlaceType::Dormitory, {3050, 260}, {{2940, 150}, {3160, 180}, {3150, 345}, {2940, 320}}},
        {"graduate_dorm_phase_1", "研究生宿舍（一期） / Graduate Student Dormitory Phase 1", PlaceType::Dormitory, {2660, 545}, {{2290, 340}, {3150, 335}, {3205, 745}, {2250, 745}}},
        {"graduate_dorm_phase_2", "研究生宿舍（二期） / Graduate Student Dormitory Phase 2", PlaceType::Dormitory, {2700, 480}, {{2260, 110}, {3180, 105}, {3220, 750}, {2220, 735}}},

        // Dining, service, sports and landscape places.
        {"first_dining_hall", "第一饭堂 / The First Dining Hall", PlaceType::Dining, {1100, 1600}, {{950, 1475}, {1185, 1460}, {1215, 1645}, {1000, 1680}}},
        {"second_dining_hall", "第二饭堂 / The Second Dining Hall", PlaceType::Dining, {1180, 780}, {{1075, 650}, {1390, 640}, {1385, 865}, {1085, 870}}},
        {"cooling_plant_2", "第二冷站 / Cooling Plant No.2", PlaceType::Service, {1300, 250}, {{1190, 185}, {1425, 145}, {1490, 330}, {1230, 370}}},
        {"campus_hospital", "校区医院 / Campus Hospital", PlaceType::Service, {1350, 500}, {{1215, 390}, {1500, 350}, {1565, 635}, {1280, 690}}},
        {"international_hotel", "中心酒店 / University Town International Hotel", PlaceType::Building, {2005, 250}, {{1845, 170}, {2165, 165}, {2165, 335}, {1845, 335}}},
        {"student_service_center", "一站式学生社区服务中心 / Student Community Service Center", PlaceType::Service, {1640, 925}, {{1465, 780}, {1815, 745}, {1910, 1010}, {1540, 1100}}},
        {"sports_stadium", "体育场 / Sports Stadium", PlaceType::Sports, {1040, 1320}, {{820, 1000}, {1220, 1000}, {1220, 1550}, {820, 1550}}},
        {"tennis_court", "网球场 / Tennis Court", PlaceType::Sports, {1510, 1160}, {{1370, 1000}, {1665, 1000}, {1660, 1250}, {1370, 1250}}},
        {"natatorium", "游泳馆 / Natatorium", PlaceType::Sports, {1510, 1450}, {{1375, 1350}, {1640, 1340}, {1650, 1555}, {1380, 1565}}},
        {"stadium", "体育馆 / Stadium", PlaceType::Sports, {1550, 1750}, {{1390, 1510}, {1745, 1510}, {1755, 1995}, {1395, 1995}}},
        {"basketball_court", "篮球场 / Basketball Court", PlaceType::Sports, {1490, 2220}, {{1260, 2080}, {1690, 2050}, {1690, 2325}, {1260, 2350}}},
        {"athletic_field", "田径场 / Athletic Field", PlaceType::Sports, {1375, 2600}, {{1145, 2350}, {1540, 2300}, {1640, 2860}, {1260, 2910}}},
        {"concert_hall", "音乐厅 / Concert Hall", PlaceType::Building, {1610, 2395}, {{1490, 2290}, {1705, 2280}, {1705, 2470}, {1480, 2480}}},
        {"registration_centre", "注册中心 / Registration Centre", PlaceType::Service, {1780, 2205}, {{1645, 2090}, {1885, 2070}, {1910, 2240}, {1680, 2260}}},
        {"library", "图书馆 / Library", PlaceType::Building, {1830, 2320}, {{1685, 2185}, {1930, 2175}, {1955, 2390}, {1710, 2410}}},
        {"wenyong_square", "文咏广场 / Wenyong Square", PlaceType::Square, {1975, 2410}, {{1760, 2160}, {2190, 2160}, {2190, 2620}, {1760, 2620}}},
        {"yue_lake", "月湖 / Yue Lake", PlaceType::Landscape, {1875, 2720}, {{1680, 2600}, {2035, 2600}, {2050, 2835}, {1710, 2875}}},
        {"qin_lake", "琴湖 / Qin Lake", PlaceType::Landscape, {2435, 920}, {{2210, 700}, {2940, 725}, {2970, 1140}, {2210, 1135}}},
        {"huxin_island", "湖心岛 / Huxin Island", PlaceType::Landscape, {2570, 875}, {{2470, 780}, {2650, 765}, {2705, 900}, {2560, 1010}, {2460, 960}}},
        {"renhouli", "仁厚里 / Renhouli", PlaceType::Landscape, {2920, 760}, {{2820, 665}, {3040, 640}, {3090, 835}, {2890, 895}}},
        {"ifang_pavilion", "一方亭 / I-fang Pavilion", PlaceType::Landscape, {2295, 775}, {{2195, 665}, {2395, 660}, {2420, 845}, {2205, 865}}},

        // Named roads on the map. These are marked as areas for later route-node alignment.
        {"shangde_road", "尚德路 / Shangde Road", PlaceType::Road, {2740, 90}, {{2220, 45}, {3310, 30}, {3315, 110}, {2220, 125}}},
        {"zhonghuan_road", "中环路 / Zhonghuan Road", PlaceType::Road, {2205, 420}, {{2160, 100}, {2250, 100}, {2260, 740}, {2170, 740}}},
        {"wenyong_road", "文咏路 / Wenyong Road", PlaceType::Road, {2180, 1340}, {{2135, 710}, {2240, 710}, {2245, 2060}, {2140, 2060}}},
        {"boxue_road_west", "博学路西 / Boxue Road West", PlaceType::Road, {2165, 1540}, {{2100, 1120}, {2205, 1120}, {2210, 2050}, {2110, 2050}}},
        {"boxue_road_east", "博学路东 / Boxue Road East", PlaceType::Road, {2870, 2010}, {{2790, 980}, {2925, 980}, {2960, 2930}, {2825, 2930}}},
        {"shangxue_road_east", "尚学路东 / Shangxue Road East", PlaceType::Road, {2555, 2035}, {{2210, 1990}, {2940, 1990}, {2940, 2075}, {2210, 2075}}},
        {"shihua_road_west", "石化路西 / Shihua Road West", PlaceType::Road, {1100, 1010}, {{1045, 220}, {1185, 220}, {1210, 1890}, {1070, 1890}}},
        {"wanyan_road", "弯岩路 / Wanyan Road", PlaceType::Road, {1710, 2960}, {{1450, 2730}, {1980, 3150}, {1930, 3225}, {1390, 2815}}}
    };
}

std::vector<RoadPolyline> BuildRoadPolylines()
{
    // Roads are represented as centerlines instead of rectangular areas. This
    // mirrors how the route renderer should work later: Dijkstra chooses graph
    // edges, and each edge carries a drawable polyline geometry.
    return {
        {"shangde_road", "尚德路 / Shangde Road",
         {{2215, 95}, {2480, 85}, {2750, 75}, {3050, 72}, {3310, 82}}, 24},
        {"zhonghuan_road", "中环路 / Zhonghuan Road",
         {{2210, 105}, {2215, 250}, {2215, 420}, {2200, 585}, {2215, 735}}, 22},
        {"wenyong_road", "文咏路 / Wenyong Road",
         {{1480, 1040}, {1460, 1260}, {1455, 1510}, {1465, 1755}, {1480, 2050}}, 26},
        {"boxue_road_west", "博学路西 / Boxue Road West",
         {{1995, 1110}, {2000, 1320}, {1995, 1535}, {2005, 1765}, {2000, 2050}}, 22},
        {"boxue_road_east", "博学路东 / Boxue Road East",
         {{2705, 980}, {2685, 1230}, {2645, 1510}, {2585, 1800}, {2535, 2090},
          {2590, 2320}, {2690, 2585}, {2780, 2930}}, 24},
        {"shangxue_road_east", "尚学路东 / Shangxue Road East",
         {{1980, 2090}, {2190, 2090}, {2390, 2095}, {2525, 2095}, {2590, 2075}}, 26},
        {"shihua_road_west", "石化路西 / Shihua Road West",
         {{1110, 220}, {1115, 520}, {1100, 825}, {1085, 1125}, {1090, 1450},
          {1120, 1720}, {1165, 1890}}, 28},
        {"wanyan_road", "弯岩路 / Wanyan Road",
         {{1425, 2735}, {1535, 2840}, {1660, 2945}, {1800, 3070}, {1940, 3205}}, 24}
    };
}

PlaceArea* FindPlaceById(std::vector<PlaceArea>& places, const std::string& id)
{
    for (size_t i = 0; i < places.size(); ++i)
    {
        if (places[i].id == id)
        {
            return &places[i];
        }
    }

    return 0;
}

void SetPlaceArea(std::vector<PlaceArea>& places,
                  const std::string& id,
                  PixelPoint center,
                  const std::vector<std::vector<PixelPoint> >& regions)
{
    PlaceArea* place = FindPlaceById(places, id);
    if (!place)
    {
        std::cerr << "Correction skipped, missing place id: " << id << "\n";
        return;
    }

    place->center = center;
    place->regions = regions;
}

void ApplyManualCorrections(std::vector<PlaceArea>& places)
{
    // Correction pass 2026-07-28:
    // Calibrates north entrances, the A/B teaching area, Yan Lake, Boxue Bridge,
    // Southgate Square and South Gate from visual feedback screenshots.
    SetPlaceArea(places, "north_1_gate", {1125, 300},
                 {{{1040, 255}, {1210, 250}, {1218, 325}, {1050, 340}}});
    SetPlaceArea(places, "cooling_plant_2", {1370, 270},
                 {{{1205, 205}, {1545, 185}, {1565, 310}, {1255, 335}},
                  {{1225, 295}, {1365, 305}, {1365, 415}, {1240, 420}}});
    SetPlaceArea(places, "campus_hospital", {1365, 455},
                 {{{1185, 405}, {1535, 405}, {1545, 500}, {1200, 510}}});
    SetPlaceArea(places, "north_gate", {2225, 145},
                 {{{2150, 105}, {2300, 105}, {2305, 180}, {2150, 185}}});
    SetPlaceArea(places, "international_hotel", {2065, 315},
                 {{{1895, 240}, {2215, 240}, {2215, 390}, {1895, 390}},
                  {{1980, 185}, {2125, 185}, {2125, 260}, {1980, 260}}});

    SetPlaceArea(places, "a1", {1825, 1955},
                 {{{1715, 1910}, {1985, 1910}, {1985, 1975}, {1715, 1975}},
                  {{1715, 2000}, {1985, 2000}, {1985, 2055}, {1715, 2055}},
                  {{1695, 1935}, {1775, 1935}, {1775, 2035}, {1695, 2035}}});
    SetPlaceArea(places, "a2", {1825, 1695},
                 {{{1715, 1650}, {1985, 1650}, {1985, 1715}, {1715, 1715}},
                  {{1715, 1750}, {1985, 1750}, {1985, 1810}, {1715, 1810}},
                  {{1695, 1680}, {1775, 1680}, {1775, 1785}, {1695, 1785}}});
    SetPlaceArea(places, "a3", {1815, 1455},
                 {{{1710, 1390}, {1975, 1390}, {1975, 1460}, {1710, 1460}},
                  {{1710, 1495}, {1975, 1495}, {1975, 1555}, {1710, 1555}},
                  {{1688, 1425}, {1770, 1425}, {1770, 1530}, {1688, 1530}}});
    SetPlaceArea(places, "a4", {1850, 1220},
                 {{{1690, 1165}, {2015, 1165}, {2015, 1240}, {1690, 1240}},
                  {{1645, 1200}, {1755, 1200}, {1755, 1300}, {1645, 1300}},
                  {{1870, 1240}, {2020, 1240}, {2020, 1300}, {1870, 1300}}});
    SetPlaceArea(places, "a5", {2190, 1190},
                 {{{2135, 1125}, {2265, 1125}, {2265, 1250}, {2135, 1250}},
                  {{2115, 1150}, {2155, 1150}, {2155, 1235}, {2115, 1235}},
                  {{2245, 1150}, {2290, 1150}, {2290, 1235}, {2245, 1235}}});

    SetPlaceArea(places, "yan_lake", {2140, 1580},
                 {{{2095, 1015}, {2320, 1010}, {2310, 1140}, {2245, 1255},
                   {2200, 1450}, {2220, 1610}, {2275, 1790}, {2240, 2035},
                   {2110, 2095}, {2050, 1900}, {2045, 1660}, {1990, 1450},
                   {2035, 1230}}});
    SetPlaceArea(places, "boxue_square", {2005, 1670},
                 {{{1950, 1300}, {2075, 1300}, {2080, 2070}, {1950, 2070}}});
    SetPlaceArea(places, "boxue_bridge", {2045, 1740},
                 {{{1970, 1710}, {2125, 1710}, {2125, 1765}, {1970, 1765}}});

    SetPlaceArea(places, "b11", {2480, 1260},
                 {{{2365, 1165}, {2625, 1165}, {2625, 1305}, {2365, 1305}},
                  {{2370, 1295}, {2490, 1295}, {2490, 1385}, {2370, 1385}},
                  {{2555, 1295}, {2655, 1295}, {2655, 1365}, {2555, 1365}}});
    SetPlaceArea(places, "b10", {2405, 1580},
                 {{{2315, 1490}, {2555, 1490}, {2555, 1695}, {2315, 1695}},
                  {{2370, 1690}, {2525, 1690}, {2525, 1755}, {2370, 1755}}});
    SetPlaceArea(places, "b9", {2405, 1905},
                 {{{2315, 1805}, {2580, 1805}, {2580, 1980}, {2315, 1980}},
                  {{2355, 1975}, {2525, 1975}, {2525, 2045}, {2355, 2045}}});
    SetPlaceArea(places, "academic_auditorium", {2165, 2215},
                 {{{2025, 2145}, {2285, 2145}, {2295, 2275}, {2050, 2290}},
                  {{2105, 2265}, {2265, 2265}, {2265, 2325}, {2105, 2325}}});
    SetPlaceArea(places, "b7", {2290, 2215},
                 {{{2165, 2145}, {2415, 2145}, {2415, 2290}, {2165, 2290}},
                  {{2225, 2095}, {2365, 2095}, {2365, 2165}, {2225, 2165}}});
    SetPlaceArea(places, "b5", {2525, 2360},
                 {{{2420, 2290}, {2645, 2290}, {2645, 2445}, {2420, 2445}},
                  {{2475, 2245}, {2595, 2245}, {2595, 2310}, {2475, 2310}}});
    SetPlaceArea(places, "b3", {2785, 2480},
                 {{{2660, 2405}, {2895, 2405}, {2895, 2495}, {2660, 2495}},
                  {{2705, 2485}, {2885, 2485}, {2885, 2565}, {2705, 2565}},
                  {{2605, 2470}, {2695, 2470}, {2695, 2535}, {2605, 2535}}});
    SetPlaceArea(places, "b1", {2995, 2640},
                 {{{2875, 2525}, {3035, 2500}, {3115, 2765}, {2950, 2815}},
                  {{2910, 2590}, {3020, 2605}, {3060, 2745}, {2940, 2765}}});
    SetPlaceArea(places, "southgate_square", {2740, 2855},
                 {{{2460, 2685}, {2875, 2650}, {3005, 2865}, {2830, 2970}, {2520, 2940}}});
    SetPlaceArea(places, "south_gate", {2895, 2975},
                 {{{2815, 2930}, {2990, 2935}, {2995, 3025}, {2825, 3030}}});

    SetPlaceArea(places, "b6", {2250, 2985},
                 {{{2105, 2920}, {2395, 2920}, {2395, 2990}, {2105, 2990}},
                  {{2105, 2985}, {2255, 2985}, {2255, 3070}, {2105, 3070}},
                  {{2290, 2985}, {2420, 2985}, {2420, 3055}, {2290, 3055}}});
    SetPlaceArea(places, "b4", {2415, 3095},
                 {{{2305, 3035}, {2555, 3035}, {2555, 3115}, {2305, 3115}},
                  {{2315, 3105}, {2490, 3105}, {2490, 3185}, {2315, 3185}},
                  {{2510, 3015}, {2595, 3015}, {2595, 3120}, {2510, 3120}}});
    SetPlaceArea(places, "b2", {2665, 3215},
                 {{{2505, 3055}, {2665, 3015}, {2820, 3310}, {2660, 3375}},
                  {{2585, 3125}, {2685, 3095}, {2765, 3260}, {2665, 3300}}});

    // Local correction pass from user screenshots: D area, library core and
    // East Gate. These use smaller component polygons to fit non-rectangular
    // buildings and plaza outlines more closely.
    SetPlaceArea(places, "first_dining_hall", {1065, 1680},
                 {{{955, 1580}, {1175, 1580}, {1175, 1690}, {995, 1705}, {950, 1640}},
                  {{1015, 1685}, {1180, 1695}, {1175, 1785}, {1065, 1790}, {990, 1745}}});
    SetPlaceArea(places, "d5", {915, 1805},
                 {{{850, 1745}, {965, 1745}, {990, 1820}, {930, 1885}, {850, 1850}}});
    SetPlaceArea(places, "d4", {985, 1905},
                 {{{920, 1845}, {1035, 1845}, {1065, 1925}, {1000, 1970}, {910, 1930}}});
    SetPlaceArea(places, "d3", {1080, 1995},
                 {{{1015, 1940}, {1155, 1940}, {1160, 2040}, {1030, 2065}, {985, 1995}}});
    SetPlaceArea(places, "east_1_gate", {1095, 1925},
                 {{{1000, 1870}, {1220, 1880}, {1225, 1955}, {1040, 1980}}});

    SetPlaceArea(places, "basketball_court", {1345, 2260},
                 {{{1225, 2135}, {1495, 2135}, {1495, 2385}, {1225, 2385}}});
    SetPlaceArea(places, "registration_centre", {1715, 2245},
                 {{{1640, 2160}, {1785, 2170}, {1820, 2245}, {1750, 2315},
                   {1640, 2310}, {1605, 2245}}});
    SetPlaceArea(places, "concert_hall", {1595, 2445},
                 {{{1530, 2385}, {1680, 2390}, {1685, 2485}, {1550, 2505}, {1510, 2440}}});
    SetPlaceArea(places, "library", {1710, 2380},
                 {{{1655, 2250}, {1775, 2280}, {1845, 2350}, {1825, 2455},
                   {1720, 2495}, {1605, 2410}, {1590, 2315}}});
    SetPlaceArea(places, "wenyong_square", {1900, 2410},
                 {{{1900, 2225}, {1990, 2250}, {2055, 2320}, {2075, 2410},
                   {2050, 2495}, {1985, 2565}, {1900, 2590}, {1815, 2565},
                   {1750, 2495}, {1725, 2410}, {1750, 2320}, {1815, 2250}}});

    SetPlaceArea(places, "east_gate", {2570, 2105},
                 {{{2485, 2045}, {2640, 2050}, {2640, 2160}, {2490, 2170}}});
}

void PrintSummary(const std::vector<PlaceArea>& places)
{
    std::cout << "Campus map image: " << kMapImageWidth << " x " << kMapImageHeight << "\n";
    std::cout << "Annotated place count: " << places.size() << "\n\n";

    for (const PlaceArea& place : places)
    {
        std::cout << place.id << ","
                  << place.name << ","
                  << ToString(place.type) << ","
                  << place.center.x << ","
                  << place.center.y << ",regions="
                  << place.regions.size() << "\n";
    }
}

void ExportSvgOverlay(const std::vector<PlaceArea>& places, const std::string& outputPath)
{
    std::ofstream out(outputPath.c_str());
    if (!out)
    {
        std::cerr << "Failed to open output file: " << outputPath << "\n";
        return;
    }

    out << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    out << "<svg xmlns=\"http://www.w3.org/2000/svg\" "
        << "width=\"" << kMapImageWidth << "\" "
        << "height=\"" << kMapImageHeight << "\" "
        << "viewBox=\"0 0 " << kMapImageWidth << " " << kMapImageHeight << "\">\n";
    out << "  <image href=\"../../微信图片_20260728004126_141_1.png\" "
        << "x=\"0\" y=\"0\" width=\"" << kMapImageWidth << "\" "
        << "height=\"" << kMapImageHeight << "\"/>\n";
    out << "  <style>\n";
    out << "    .area { fill-opacity: 0.22; stroke-width: 8; stroke-opacity: 0.9; }\n";
    out << "    .road-line { fill: none; stroke: #475569; stroke-opacity: 0.65; "
        << "stroke-linecap: round; stroke-linejoin: round; }\n";
    out << "    .road-label { font: 36px Arial, sans-serif; fill: #334155; "
        << "paint-order: stroke; stroke: #ffffff; stroke-width: 7; stroke-linejoin: round; }\n";
    out << "    .center { fill: #111827; stroke: #ffffff; stroke-width: 5; }\n";
    out << "    .label { font: 42px Arial, sans-serif; fill: #111827; "
        << "paint-order: stroke; stroke: #ffffff; stroke-width: 8; stroke-linejoin: round; }\n";
    out << "  </style>\n";

    for (const PlaceArea& place : places)
    {
        if (place.type == PlaceType::Road)
        {
            continue;
        }

        const char* color = FillColor(place.type);
        out << "  <g id=\"" << place.id << "\" data-name=\"" << place.name
            << "\" data-type=\"" << ToString(place.type) << "\">\n";

        for (size_t regionIndex = 0; regionIndex < place.regions.size(); ++regionIndex)
        {
            const std::vector<PixelPoint>& region = place.regions[regionIndex];
            out << "    <polygon class=\"area\" fill=\"" << color << "\" stroke=\"" << color << "\" points=\"";

            for (size_t i = 0; i < region.size(); ++i)
            {
                if (i > 0)
                {
                    out << " ";
                }
                out << region[i].x << "," << region[i].y;
            }

            out << "\"/>\n";
        }

        out << "    <circle class=\"center\" cx=\"" << place.center.x
            << "\" cy=\"" << place.center.y << "\" r=\"13\"/>\n";
        out << "    <text class=\"label\" x=\"" << place.center.x + 18
            << "\" y=\"" << place.center.y - 18 << "\">" << place.id << "</text>\n";
        out << "  </g>\n";
    }

    const std::vector<RoadPolyline> roads = BuildRoadPolylines();
    for (const RoadPolyline& road : roads)
    {
        out << "  <g id=\"" << road.id << "\" data-name=\"" << road.name
            << "\" data-type=\"road\">\n";
        out << "    <polyline class=\"road-line\" stroke-width=\"" << road.width
            << "\" points=\"";

        for (size_t i = 0; i < road.points.size(); ++i)
        {
            if (i > 0)
            {
                out << " ";
            }
            out << road.points[i].x << "," << road.points[i].y;
        }

        out << "\"/>\n";

        if (!road.points.empty())
        {
            const PixelPoint& labelPoint = road.points[road.points.size() / 2];
            out << "    <text class=\"road-label\" x=\"" << labelPoint.x + 18
                << "\" y=\"" << labelPoint.y - 18 << "\">" << road.id << "</text>\n";
        }

        out << "  </g>\n";
    }

    out << "</svg>\n";
}
} // namespace campus

int main()
{
    std::vector<campus::PlaceArea> places = campus::BuildInitialPlaceAreas();
    campus::ApplyManualCorrections(places);
    campus::PrintSummary(places);
    _mkdir("visual_check");
    campus::ExportSvgOverlay(places, "visual_check/campus_map_annotation_overlay.svg");
    std::cout << "\nSVG overlay exported: visual_check/campus_map_annotation_overlay.svg\n";
    return 0;
}
