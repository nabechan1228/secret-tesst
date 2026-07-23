import { TourScenario, TourStep } from './types';

export const TOUR_SCENARIOS: TourScenario[] = [
  {
    id: 'spring_highlights',
    title: '🌸 春の夜空と銀河めぐり',
    description: '春の大曲線からしし座、おとめ座銀河団へ至る満天の春の夜空ハイライト',
    steps: [
      {
        title: 'うしかい座 一等星アークトゥルス',
        targetAz: 180,
        targetAlt: 55,
        zoomLevel: 45,
        durationSec: 8,
        description: '「春の夫婦星」の一つ、オレンジ色に強く輝く0等星アークトゥルス。全天で第3位の明るさを誇ります。'
      },
      {
        title: 'おとめ座 一等星スピカ',
        targetAz: 165,
        targetAlt: 40,
        zoomLevel: 35,
        durationSec: 8,
        description: '純白に輝く真珠のような1等星スピカ。「春の大曲線」の終着点となる青白い巨星です。'
      },
      {
        title: 'しし座 一等星レグルス',
        targetAz: 220,
        targetAlt: 45,
        zoomLevel: 40,
        durationSec: 8,
        description: 'ライオンの胸元に輝く「小さな王」レグルス。逆クエスチョンマーク状の「ライオンの鎌」が目印です。'
      },
      {
        title: '子持ち銀河 M51 (Messier 51)',
        targetAz: 350,
        targetAlt: 65,
        zoomLevel: 15,
        durationSec: 10,
        description: 'おおぐま座の尻尾の先にある有名な渦巻銀河。伴銀河を引き連れる姿が印象的な深宇宙天体です。'
      }
    ]
  },
  {
    id: 'winter_jewels',
    title: '💎 冬のダイヤモンドと大星雲',
    description: 'オリオン座、シリウス、昴（すばる）など夜空で最も華やかな冬の星々',
    steps: [
      {
        title: 'オリオン座 三つ星と大星雲 M42',
        targetAz: 180,
        targetAlt: 45,
        zoomLevel: 30,
        durationSec: 10,
        description: '冬の夜空の王者オリオン座。中央の三つ星のすぐ下には広大な鳥のようなオリオン大星雲(M42)が輝きます。'
      },
      {
        title: 'おおいぬ座 一等星シリウス',
        targetAz: 150,
        targetAlt: 35,
        zoomLevel: 45,
        durationSec: 8,
        description: '全天で最も明るく輝く恒星シリウス(-1.46等)。青白いダイヤモンドのような強い瞬きを放ちます。'
      },
      {
        title: 'おうし座 プレアデス星団 (すばる M45)',
        targetAz: 240,
        targetAlt: 50,
        zoomLevel: 12,
        durationSec: 10,
        description: '肉眼でも6〜7個の星が集まって見える青い散開星団。和名「すばる」として古くから親しまれています。'
      }
    ]
  },
  {
    id: 'solar_system_planets',
    title: '🪐 太陽系惑星と月めぐり',
    description: '木星の縞模様、土星の環、火星の赤い輝きを巡る惑星観察ツアー',
    steps: [
      {
        title: '太陽系最大の惑星 木星 (Jupiter)',
        targetAz: 140,
        targetAlt: 30,
        zoomLevel: 8,
        durationSec: 9,
        description: 'ガリレオ衛星を引き連れて輝く木星。望遠鏡では大赤斑や鮮やかな縞模様が観察できます。'
      },
      {
        title: '環を持つ神秘の惑星 土星 (Saturn)',
        targetAz: 200,
        targetAlt: 35,
        zoomLevel: 6,
        durationSec: 9,
        description: '氷と岩石でできた美しい大きな環を持つ土星。穏やかな黄色の光を放ちます。'
      },
      {
        title: '赤い惑星 火星 (Mars)',
        targetAz: 110,
        targetAlt: 25,
        zoomLevel: 10,
        durationSec: 8,
        description: '表面の酸化鉄により赤く不気味に輝く火星。ギリシャ神話のアレス（戦いの神）に例えられます。'
      }
    ]
  }
];

export class SkyTourController {
  private activeScenario: TourScenario | null = null;
  private currentStepIdx: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private stepTimer: any = null;

  public onStepChange?: (step: TourStep, idx: number, total: number) => void;
  public onTourEnd?: () => void;

  public startTour(scenarioId: string) {
    const scenario = TOUR_SCENARIOS.find(s => s.id === scenarioId);
    if (!scenario) return;

    this.activeScenario = scenario;
    this.currentStepIdx = 0;
    this.isRunning = true;
    this.isPaused = false;
    this.executeCurrentStep();
  }

  public pauseTour() {
    this.isPaused = true;
    if (this.stepTimer) clearTimeout(this.stepTimer);
  }

  public resumeTour() {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.executeCurrentStep();
  }

  public stopTour() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.onTourEnd) this.onTourEnd();
  }

  public nextStep() {
    if (!this.activeScenario) return;
    if (this.currentStepIdx < this.activeScenario.steps.length - 1) {
      this.currentStepIdx++;
      this.executeCurrentStep();
    } else {
      this.stopTour();
    }
  }

  public prevStep() {
    if (!this.activeScenario) return;
    if (this.currentStepIdx > 0) {
      this.currentStepIdx--;
      this.executeCurrentStep();
    }
  }

  private executeCurrentStep() {
    if (!this.activeScenario || !this.isRunning) return;
    if (this.stepTimer) clearTimeout(this.stepTimer);

    const step = this.activeScenario.steps[this.currentStepIdx];
    if (this.onStepChange) {
      this.onStepChange(step, this.currentStepIdx + 1, this.activeScenario.steps.length);
    }

    if (!this.isPaused) {
      this.stepTimer = setTimeout(() => {
        this.nextStep();
      }, step.durationSec * 1000);
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }
}
